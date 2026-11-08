"""Derive lighting materials from the shipped Standard BLS, without rebuilding unrelated effects.

Outputs candidates only. Intermediate data lives under the caller's _tmp directory.
Uses the local audited DXBC reader/validator; never deploys into Warcraft or Latest.
"""
import argparse,collections,hashlib,json,math,re,struct,sys,types
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--output',required=True)
parser.add_argument('--shader-tools',default='D:/Quenching/QM/shaders/03_Scripts')
parser.add_argument('--hd-only',action='store_true')
parser.add_argument('--material-only',action='store_true')
parser.add_argument('--families',nargs='+',choices=('hd','terrain','cliffblightmiscterrain','foliage','sd_on_hd'))
parser.add_argument('--assets-root',help='Expanded shader directory; defaults to assets/unpacked/shaders when present')
parser.add_argument('--battle-splats-only',action='store_true',help='Repair protected HD building splats only, retaining all other current Battle programs')
args=parser.parse_args()
repo=Path(__file__).resolve().parents[1];out=Path(args.output).resolve()
if not out.is_relative_to(repo/'_tmp'):raise ValueError('Candidate output must be inside repository _tmp')
out.mkdir(parents=True,exist_ok=False)
tools=Path(args.shader_tools);suite=tools/'unified_shader_suite'
sys.dont_write_bytecode=True
sys.modules['project_paths']=types.SimpleNamespace(ROOT=suite)
sys.path[:0]=[str(suite/'vendor/tools'),str(suite),str(tools)]
import bls_tool
from dxbc_checksum import install
bls_tool.CalculateDXBCChecksum=install()
from dxbc_tools import read_bls,write_bls,replace_program,program,parts,ShaderValidator
from team_color_301 import mechanics as c
from lighting_material_inputs import patch_battle_inputs,BATTLE_METALLIC_MULTIPLIER,BATTLE_ROUGHNESS_ADD,BATTLE_ROUGHNESS_MULTIPLIER

def lit(x):return c.words(16385)+struct.pack('<f',x)
def lit4(v):return c.words(16386)+struct.pack('<4f',*v)
def sha(b):return hashlib.sha256(b).hexdigest()

validator=ShaderValidator();validated=set();patch_cache={}
report={'schema':1,'source':'shipped Standard BLS','files':[],
 'hdRpg':{'cloudClear':1.5,'cloudDark':0.5,'diffuse':1.25,'dielectricF0':0.05,'saturation':0.95,'exposure':0.85,'roughnessAdd':-0.1,'roughnessMultiplier':0.95,'normalXY':1.5,'terrainNormalXY':1.5},
 'hdBattle':{'cloud':False,'baseColorBrightness':0.95,'diffuse':1.25,'groundDiffuse':1.6,'foliageDiffuse':1.6,'dielectricF0':0.01,'saturation':0.94,'exposure':1,'metallicMultiplier':BATTLE_METALLIC_MULTIPLIER,'roughnessAdd':BATTLE_ROUGHNESS_ADD,'roughnessMultiplier':BATTLE_ROUGHNESS_MULTIPLIER,'fresnelGrazing':[1,1,1],'environmentSpecular':1,'f0Multiplier':[1,1,1],'shadowEnvironmentSpecularRetention':1,'shadowEnvironmentFill':1},
 'groundSharedGrade':['terrain','cliffblightmiscterrain'],
 'de':{'standardAndRpg':'unchanged','battle':'current DE without clouds'}}

def transform(blob,family,mode,protect_splat=False):
    key=(blob,family,mode,protect_splat)
    if key in patch_cache:return patch_cache[key]
    rows,lines=c.unpack(blob);data=[r[2] for r in rows];counts=collections.Counter()
    if not any('texturecubearray' in l for l in lines):
        patch_cache[key]=(blob,{});return blob,{}
    dt=next(i for i,l in enumerate(lines) if l.startswith('dcl_temps '));temps=int(lines[dt].split()[1])
    def allocate():
        nonlocal temps
        result=temps;temps+=1
        if temps>=4096:raise ValueError('Temporary register limit')
        return result
    def grade_rgb(index,dst,cfg):
        grey=allocate()
        data[index]+=c.op(16,c.dest(grey),c.vec(dst),lit4([.2126,.7152,.0722,0]))+c.op(56,c.dest(dst,7),c.vec(dst),lit(cfg['saturation']))+c.op(50,c.dest(dst,7),c.src(grey),lit(1-cfg['saturation']),c.vec(dst))+c.op(52,c.dest(dst,7),c.vec(dst),lit(0))+c.op(56,c.dest(dst,7),c.vec(dst),lit(cfg['exposure']))
        counts['rgb_grade']+=1
    tail=None
    cloud=[i for i,l in enumerate(lines) if re.match(r'mad r\d+\.xy, -v15\.',l)]
    if cloud:
        if len(cloud)!=1:raise ValueError('Ambiguous existing cloud epilogue')
        tail=cloud[0]
        saved_rows=[(j,m) for j in range(tail,len(lines)) if (m:=re.fullmatch(r'mov o0\.w, r(\d+)\.xyzw',lines[j]))]
        if len(saved_rows)>1:raise ValueError('Ambiguous cloud alpha restore')
        if lines[-1]!='ret':raise ValueError('Unexpected cloud program exit')
        saved=int(saved_rows[0][1][1]) if saved_rows else None
        cloud_end=saved_rows[0][0] if saved_rows else len(data)-2
        if saved is None:
            consumers=[]
            for j in range(tail,len(lines)-1):
                blend=re.fullmatch(r'mad r(\d+)\.x, r\d+\.x, r\d+\.x, r\1\.y',lines[j])
                if blend and re.fullmatch(r'mul (r\d+)\.xyz, \1\.xyzw, r'+blend[1]+r'\.x',lines[j+1]):consumers.append(j+1)
            if len(consumers)!=1:
                (out/'debug-inline-cloud.txt').write_text('\n'.join(lines[tail:]),encoding='utf8')
                raise ValueError('Unknown inlined splat cloud consumer')
            cloud_end=consumers[0]
            if any(l.split()[0] in ('if_nz','if_z','else','endif','loop','endloop','switch','endswitch','break') for l in lines[tail:cloud_end]):
                (out/'debug-inline-cloud.txt').write_text('\n'.join(lines[tail:cloud_end+5]),encoding='utf8')
                raise ValueError('Cloud removal would cross material control flow')
        if mode in ('battle','de-battle'):
            # Retain the saved color register until grading is complete. Terrain
            # writes its color matrix directly there; redirecting those writes
            # to o0 first would make later grading read an uninitialized temp.
            for i in range(tail,cloud_end+1):data[i]=b''
            if saved is not None:data[tail]=c.op(54,c.dest(0,15,2),c.vec(saved))
            counts['cloud_removed']=1
        else:
            configs=[i for i in range(tail,len(lines)) if re.match(r'mad r\d+\.xy, r\d+\.xxxx, l\(',lines[i]) and len(data[i])>=40 and struct.unpack('<I',data[i][-40:-36])[0]==16386 and struct.unpack('<I',data[i][-20:-16])[0]==16386]
            # Identify the final density→direct/shadow multiplier, not noise constants.
            configs=[i for i in configs if any(abs(struct.unpack('<f',data[i][-16:-12])[0]-v)<1e-6 for v in (1.4,1.5))]
            if len(configs)==1:
                i=configs[0];slope=list(struct.unpack('<4f',data[i][-36:-20]));clear=list(struct.unpack('<4f',data[i][-16:]));slope[:2]=[-1.,-.6];clear[:2]=[1.5,1.5]
                data[i]=data[i][:-40]+lit4(slope)+lit4(clear)
            elif any(re.fullmatch(r'mad r(\d+)\.x, r\1\.x, l\(-0\.700000\), l\(1\.400000\)',l) for l in lines[tail:cloud_end]):
                # Standard cloud contrast changed independently; RPG keeps its own endpoints.
                for j in range(tail,cloud_end):
                    if re.fullmatch(r'mad r(\d+)\.x, r\1\.x, l\(-0\.700000\), l\(1\.400000\)',lines[j]):data[j]=data[j][:-16]+lit(-1)+lit(1.5)
                    if re.fullmatch(r'mad r\d+\.y, r\d+\.z, l\(-0\.500000\), l\(1\.400000\)',lines[j]):data[j]=data[j][:-16]+lit(-.6)+lit(1.5)
            elif not any(re.fullmatch(r'mad r\d+\.x, -r\d+\.y, r\d+\.x, l\(1\.500000\)',l) for l in lines[max(tail,cloud_end-22):cloud_end]):
                raise ValueError('Cloud lighting parameter anchor changed')
            counts['cloud_1_5_to_0_5']=1
    elif any('-v15.' in l for l in lines):raise ValueError('Unrecognized cloud program')

    if mode!='de-battle' and not protect_splat:
        limit=tail if tail is not None else len(lines)
        for i,line in enumerate(lines[:limit]):
            if family=='hd' and mode in ('rpg','battle'):
                cfg=report['hdRpg' if mode=='rpg' else 'hdBattle']
                base_sample=re.fullmatch(r'sample_indexable\(texture2d\)\(float,float,float,float\) r(\d+)\.xyzw, v2\.xyxx, t0\.xyzw, s0',line)
                if base_sample and mode=='battle':
                    reg=base_sample[1]
                    brightness=[j for j in range(i+1,min(i+13,len(lines))) if re.fullmatch(r'mul_sat r'+reg+r'\.xyz, r'+reg+r'\.xyz, l\(0\.750000\)',lines[j])]
                    if len(brightness)>1:raise ValueError('Ambiguous HD base-color brightness')
                    if brightness:
                        j=brightness[0];data[j]=data[j][:-4]+struct.pack('<f',cfg['baseColorBrightness']);counts['base_color_brightness_replaced']+=1
                    else:
                        # The protected building-splat path has no color-bias or
                        # dimming block and already uses neutral base brightness.
                        if not lines[i+1].startswith('sample_indexable'):raise ValueError('Unknown neutral base-color path')
                        if cfg['baseColorBrightness']!=1:
                            data[i]+=c.op(56|8192,c.dest(int(reg),7),c.vec(int(reg),'xyzx'),lit(cfg['baseColorBrightness']))
                            counts['base_color_brightness_inserted']+=1
                        else:counts['base_color_brightness_native_1']+=1
                    counts['base_color_brightness']+=1
                sample=re.fullmatch(r'sample_indexable\(texture2d\)\(float,float,float,float\) r(\d+)\.([xyzw]+), v2\.xyxx, t2\.([xyzw]{4}), s2',line)
                if sample and mode=='rpg':
                    # ORM.G is roughness; match the sample swizzle to its actual
                    # destination component, leaving metallic and occlusion intact.
                    reg=int(sample[1])
                    components=[k for k in sample[2] if sample[3]['xyzw'.index(k)]=='y']
                    if len(components)!=1:raise ValueError('Ambiguous roughness sample')
                    comp='xyzw'.index(components[0]);mask=1<<comp
                    data[i]+=c.op(0,c.dest(reg,mask),c.src(reg,comp),lit(cfg['roughnessAdd']))+c.op(56|8192,c.dest(reg,mask),c.src(reg,comp),lit(cfg['roughnessMultiplier']))
                    counts['roughness_input']+=1
                m=re.fullmatch(r'mul r(\d+)\.([xyzw]{2}), r\d+\.[xyzw]{4}, cb2\[27\]\.xxxx',line)
                if m and mode=='rpg':
                    data[i]+=c.op(56,c.dest(int(m[1]),sum(1<<'xyzw'.index(k) for k in m[2])),c.vec(int(m[1])),lit(1.5));counts['normal_1_5']+=1
                if re.fullmatch(r'mul r\d+\.xyz, r\d+\.xyzx, l\(0\.318310, 0\.318310, 0\.318310, 0\.000000\)',line):
                    raw=rows[i][2];native=struct.unpack('<f',raw[-16:-12])[0]
                    data[i]=raw[:-20]+lit4([native*cfg['diffuse']]*3+[0]);counts['diffuse_'+str(cfg['diffuse']).replace('.','_')]+=1
                    f0=re.fullmatch(r'mul r(\d+)\.xyz, r(\d+)\.xyzx, r(\d+)\.([xyzw])\4\4\4',lines[i-2])
                    if not f0:raise ValueError('F0 material anchor changed')
                    fr,base,metal=map(int,f0.groups()[:3]);comp='xyzw'.index(f0[4]);temp=allocate()
                    data[i-2]+=c.op(50,c.dest(temp),c.src(metal,comp),lit(-cfg['dielectricF0']),lit(cfg['dielectricF0']))+c.op(0,c.dest(fr,7),c.vec(fr),c.src(temp))+c.op(56|8192,c.dest(fr,7),c.vec(fr),lit4([1,1,1,0]))
                    for j,other in enumerate(lines[:limit]):
                        fm=re.fullmatch(r'mad r(\d+)\.xyz, -r'+str(metal)+r'\.'+('xyzw'[comp]*4)+r', r'+str(base)+r'\.xyzx, l\(0\.500000, 0\.500000, 0\.500000, 0\.000000\)',other)
                        if fm:data[j]=c.op(50,c.dest(int(fm[1]),7),c.vec(fr),lit(-1),lit4([*cfg.get('fresnelGrazing',[.5,.5,.5]),0]))
                    counts['dielectric_f0_'+str(cfg['dielectricF0']).replace('.','_')]+=1
                matrix=re.fullmatch(r'dp3 r(\d+)\.z, l\(-0\.030000, -0\.060000, (?:1\.210000|1\.090000), 0\.000000\), r\d+\.xyzx',line)
                if matrix:grade_rgb(i,int(matrix[1]),cfg)
            if (family in ('terrain','cliffblightmiscterrain') or (family=='foliage' and mode=='battle')) and mode in ('rpg','battle'):
                cfg=report['hdRpg' if mode=='rpg' else 'hdBattle']
                if re.fullmatch(r'mul r\d+\.xyz, r\d+\.xyzx, l\(0\.318310, 0\.318310, 0\.318310, 0\.000000\)',line):
                    raw=rows[i][2];native=struct.unpack('<f',raw[-16:-12])[0]
                    factor=cfg.get('groundDiffuse',cfg['diffuse'])
                    data[i]=raw[:-20]+lit4([native*factor]*3+[0]);counts['diffuse_'+str(factor).replace('.','_')]+=1
                matrix=re.fullmatch(r'dp3 r(\d+)\.z, l\(-0\.030000, -0\.060000, (?:1\.210000|1\.090000), 0\.000000\), r\d+\.xyzx',line)
                if matrix:grade_rgb(i,int(matrix[1]),cfg)
            if family in ('terrain','cliffblightmiscterrain') and mode=='rpg':
                m=re.fullmatch(r'sqrt r(\d+)\.z, r\d+\.[xyzw]',line)
                if m and i+1<len(lines) and lines[i+1].startswith('dp3 '):
                    r=int(m[1]);data[i]+=c.op(56,c.dest(r,3),c.vec(r),lit(1.5));counts['terrain_normal_1_5']+=1
            if family=='hd' and mode=='battle':
                m=re.fullmatch(r'mad r(\d+)\.xyz, -r\d+\.[xyzw]{4}, r\d+\.xyzx, l\(0\.500000, 0\.500000, 0\.500000, 0\.000000\)',line)
                if m:data[i]=data[i][:-20]+lit4([1,1,1,0]);counts['f90_1']+=1
                if re.match(r'sample_l_indexable\(texturecubearray\)',line):
                    sample=re.search(r' r(\d+)\.[xyzw]+,',line)
                    if sample and re.fullmatch(r'mul r'+sample[1]+r'\.[xyzw]+, r'+sample[1]+r'\.xyzw, l\(0\.750000, 0\.750000, 0\.750000, 0\.750000\)',lines[i+1]):
                        data[i+1]=data[i+1][:-20]+lit4([1,1,1,1]);counts['environment_specular_1']+=1
                if re.fullmatch(r'movc r\d+\.x, r\d+\.x, l\(0\.400000\), cb2\[28\]\.w',line):
                    if not re.fullmatch(r'mul r\d+\.x, r\d+\.x, l\(0\.600000\)',lines[i+1]):raise ValueError('Standard environment-fill parameter changed')
                    data[i+1]=data[i+1][:-8]+lit(1);counts['environment_fill_1']+=1
    if temps!=int(lines[dt].split()[1]):data[dt]=c.words(0x02000068,temps)
    result=replace_program(blob,program(blob)[:8]+b''.join(data)) if any(a!=b[2] for a,b in zip(data,rows)) else blob
    if mode=='battle' and not protect_splat:
        result,hits=patch_battle_inputs(result,family);counts.update(hits)
    if [(t,b) for t,b in parts(result) if t not in (b'SHEX',b'SHDR')] != [(t,b) for t,b in parts(blob) if t not in (b'SHEX',b'SHDR')]:raise ValueError('Shader interface changed')
    if result not in validated:validator.check(result);validated.add(result)
    # Real output disassembly must lose cloud noise for no-cloud profiles.
    if mode in ('battle','de-battle') and cloud and any('-v15.' in l for l in c.unpack(result)[1]):raise ValueError('Cloud instructions remain')
    patch_cache[key]=(result,dict(counts));return result,dict(counts)

try:
    assets=Path(args.assets_root).resolve() if args.assets_root else repo/('assets/unpacked/shaders' if (repo/'assets/unpacked/shaders').is_dir() else 'assets/quenching/shaders')
    for pack in ('shaders-300-hd','shaders-ptr-hd','shaders-300-de','shaders-ptr-de'):
        is_hd=pack.endswith('-hd');source=assets/pack/('ps/standard' if is_hd else 'ps')
        if args.battle_splats_only and not is_hd:continue
        if args.hd_only and not is_hd:continue
        for mode in (('rpg','battle') if is_hd else ('de-battle',)):
            if args.battle_splats_only and mode!='battle':continue
            destination=out/'shaders'/pack/('ps/rpg' if mode=='rpg' else 'ps/melee' if is_hd else 'battle/ps')
            destination.mkdir(parents=True)
            for file in sorted(source.glob('*.bls')):
                if args.battle_splats_only and file.stem!='hd':continue
                if args.material_only and file.name!='hd.bls':continue
                if args.families and file.stem not in args.families:continue
                header,entries=read_bls(file);result=[];stats=collections.Counter();changed=0
                family=file.stem
                previous_entries=read_bls(assets/pack/'ps/melee'/file.name)[1] if args.battle_splats_only else None
                for variant,(record,blob) in enumerate(entries):
                    # Verified building-splat path and its 3.01 second-bank variant.
                    protect_splat=family=='hd' and mode=='battle' and variant in (448,1472)
                    if protect_splat:
                        ls=c.unpack(blob)[1]
                        if not any('texturecubearray' in l for l in ls) or any(' t4.' in l for l in ls):raise ValueError('Protected splat layout changed')
                    if previous_entries is not None and not protect_splat:
                        fixed,hits=previous_entries[variant][1],{}
                    else:
                        fixed,hits=transform(blob,family,mode,protect_splat) if family in ('hd','terrain','cliffblightmiscterrain','foliage','sd_on_hd') else (blob,{})
                    result.append((record,fixed));stats.update(hits);changed+=fixed!=(previous_entries[variant][1] if previous_entries is not None else blob)
                target=destination/file.name
                # Existing post-processing modes are independent of this material edit.
                previous=assets/pack/'ps/melee'/file.name
                if is_hd and mode=='battle' and family not in ('hd','terrain','cliffblightmiscterrain','foliage','sd_on_hd') and previous.exists():target.write_bytes(previous.read_bytes())
                else:write_bls(target,header,result)
                reread=read_bls(target)[1]
                if len(reread)!=len(entries):raise ValueError('BLS variant count changed')
                report['files'].append({'file':target.relative_to(out).as_posix(),'source':str(file),'sourceSha256':sha(file.read_bytes()),'sha256':sha(target.read_bytes()),'changedVariants':changed,'counts':dict(stats)})
                print(pack,mode,file.name,changed,flush=True)
    report['uniqueProgramsValidated']=len(validated)
    (out/'build-report.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    print('PASS: candidates built and WARP validated; no installation',flush=True)
finally:validator.close()
