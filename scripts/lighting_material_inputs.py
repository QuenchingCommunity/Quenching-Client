"""Patch Battle ORM inputs without changing unrelated material or MRT code."""
import re,struct
from dxbc_tools import program,replace_program,parts
from team_color_301 import mechanics as c

BATTLE_METALLIC_MULTIPLIER=.75
BATTLE_ROUGHNESS_ADD=.05
BATTLE_ROUGHNESS_MULTIPLIER=1.1

def patch_battle_inputs(blob,family):
    rows,lines=c.unpack(blob)
    if family not in ('hd','terrain','cliffblightmiscterrain') or not any('texturecubearray' in line for line in lines):return blob,{}
    data=[row[2] for row in rows];samples=0
    for i,line in enumerate(lines):
        sample=re.fullmatch(r'sample_indexable\(texture2d(?:array)?\)\(float,float,float,float\) r(\d+)\.([xyzw]+), .+, t2\.([xyzw]{4}), s2',line)
        if not sample:continue
        reg=int(sample[1]);channels={sample[3]['xyzw'.index(k)]:k for k in sample[2]}
        if not {'y','z'}.intersection(channels):continue # auxiliary AO-only t2 read
        if not {'y','z'}.issubset(channels):raise ValueError('Incomplete roughness/metallic sample')
        rough,metal=channels['y'],channels['z'];ri='xyzw'.index(rough);mi='xyzw'.index(metal)
        affine={}
        for j in range(i+1,min(i+7,len(lines))):
            m=re.fullmatch(r'(add|mul) r'+str(reg)+r'\.([xyzw]+), r'+str(reg)+r'\.\2, l\(([^)]+)\)',lines[j])
            if not m or rough not in m[2] or metal not in m[2]:continue
            values=m[3].split(', ')
            if len(values)!=4:continue
            if m[1] in affine:raise ValueError('Ambiguous existing ORM adjustment')
            affine[m[1]]=j
        if affine:
            if set(affine)!={'add','mul'}:raise ValueError('Incomplete existing ORM adjustment')
            for name,value in [('add',BATTLE_ROUGHNESS_ADD),('mul',BATTLE_ROUGHNESS_MULTIPLIER)]:
                j=affine[name];raw=data[j]
                if struct.unpack('<I',raw[-20:-16])[0]!=16386:raise ValueError('Unknown ORM vector immediate')
                values=list(struct.unpack('<4f',raw[-16:]))
                if name=='add' and abs(values[mi])>1e-6:raise ValueError('Unexpected metallic offset')
                values[ri]=value
                if name=='mul':values[mi]=BATTLE_METALLIC_MULTIPLIER
                data[j]=raw[:-16]+struct.pack('<4f',*values)
        else:
            if family!='hd':raise ValueError('Missing ground ORM affine anchor')
            metallic=[j for j in range(i+1,min(i+7,len(lines))) if re.fullmatch(r'mul_sat r'+str(reg)+r'\.'+metal+r', r'+str(reg)+r'\.'+metal+r', l\(0\.750000\)',lines[j])]
            if len(metallic)!=1:raise ValueError('Unknown HD metallic input')
            j=metallic[0];data[j]=data[j][:-4]+struct.pack('<f',BATTLE_METALLIC_MULTIPLIER)
            # Keep the native downstream roughness clamp/range. ORM alpha and
            # team-mask captures stay intact.
            literal=lambda x:c.words(16385)+struct.pack('<f',x)
            data[i]+=c.op(0,c.dest(reg,1<<ri),c.src(reg,ri),literal(BATTLE_ROUGHNESS_ADD))+c.op(56,c.dest(reg,1<<ri),c.src(reg,ri),literal(BATTLE_ROUGHNESS_MULTIPLIER))
        samples+=1
    expected=4 if family=='terrain' else 1
    if samples!=expected:raise ValueError(f'{family}: expected {expected} ORM samples, got {samples}')
    fixed=replace_program(blob,program(blob)[:8]+b''.join(data))
    if [(t,b) for t,b in parts(blob) if t not in (b'SHEX',b'SHDR')]!=[(t,b) for t,b in parts(fixed) if t not in (b'SHEX',b'SHDR')]:raise ValueError('Material interface changed')
    return fixed,{'roughness_input_samples':samples,'metallic_input_samples':samples}
