import React from 'react';
import { Typography, Space, Divider, Button } from 'antd';
import { GithubOutlined, GlobalOutlined, HeartOutlined } from '@ant-design/icons';
import { useTranslation } from '../../utils/i18n';
import { useSound } from '../../hooks/useSound';
import { OverlayModal } from './OverlayModal';
import { APP_VERSION } from '../../version';

const { Title, Text, Paragraph } = Typography;

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ open, onClose }) => {
  const { t, currentLanguage } = useTranslation();
  const { playSmall, playHover } = useSound();

  // 根据语言选择收款码图片
  const isChinese = currentLanguage === 'zh-CN';
  const qrCode1 = isChinese
    ? './assets/quenching/962b388fc81544d58b857d7dedade73e.png'
    : './assets/quenching/1paypal.png';
  const qrCode2 = isChinese
    ? './assets/quenching/21d39a30b6f638c5081d47fce3daf453.png'
    : './assets/quenching/1usdc.png';
  const qrLabel1 = isChinese ? t('about.support.alipay') : 'PayPal';
  const qrLabel2 = isChinese ? t('about.support.wechat') : 'USDC';

  const handleOpenLink = (url: string) => {
    window.electronAPI?.openExternal(url);
  };

  const creditCategories = [
    {
      title: t('about.category.tools'),
      members: '暴雪经典组 / 霜冻公爵 / AMDOpen / FFXDirve / Reteras-Magos / Blender / Nvtt / Ladik'
    },
    {
      title: t('about.category.code'),
      members: 'WardenIO / Tasyen / 幻想的仪式 / 杰克川 / TriggerHappy / Dariusz Sikorski (dariuszsikorski)'
    },
    {
      title: t('about.category.art'),
      members: 'kantarion / Mystic / Xyrohn21 / Malmgreva / CSWteam / Vulfar / Mr.Orgeman / Superfrycook'
    },
    {
      title: t('about.category.media'),
      members: 'Hiveworkshop / 魔坛情报局 / 网易暴雪 / Back2Warcraft / W3Unite / 桥林 / 星星哥 / 格瓦斯劳斯基 / 依瑞斯 / 斯美拉琪海露 / 战术TNT / WRY魔兽联盟 / 平川电竞 / 冰糖解说 / Ralle / Warglaive / Kam / wTc / Yumiko / Arrow\'s Path / PavellGameChannel / Wanderbraun / FenixGaming / ReyGaming'
    },
    {
      title: t('about.category.campaign'),
      members: 'InsaneMonster / Tomoraider / 记忆 / 鬼画桃符 / 花仙 / 织星人 / 淬火粉丝 / 安林喵 / 是甜食哇 / 无可救药的废萌 / 暗夜鱼人艾琳 / Scream放点盐 / 成都第二菜包子'
    },
    {
      title: t('about.category.community'),
      members: '呜喵王 / 大叔 / 白羽 / hahatgj / 逆鳞 / 大哥 / Saido / taichi / pat / dingo'
    },
    {
      title: t('about.category.translation'),
      members: '蓝蓝子 / Andreiki / Antraxis / AzashBR / Azqswxzeman沐恩大军 / 远古杀戮者 / 成都第二菜包子 / yhx1129 / Allen / Su夜樱梦琉 / 安哥唯是我 / bili_54272497996 / 王师天下 / Tomcat沉诣 / ThomasDetective / eitac / 茶几先生丶 / 小生意気なロリコン / SunMoonman / LoreCraft / 蓝色的天空之意 / icywreck / MeantIt / 老白人生 / Corgiloveartisanyoung / 略嗨PuTonSpeeD / Yang大侠不迟到 / 慕雪时晴 / 超魔导师马哈德 / 凡尘不动我心 / 中华唯我霸天健 / DandLX / 阿祁_51 / 捉奸大师PetersJulian / DanielbimFreelancer / Euljan-Nick / 呢喃的寻梦者老白 / 憨憨人士 / 大青蛙 / 杨声耀 / 带着铅笔去流浪 / 杰 / jerry / kusanagi浮幽者叶羽星辰 / 傲瑰 / 万事屋银银银酱 / 彼岸无垠 / 不看不看-辉耀狂战 / Dariusz Sikorski (dariuszsikorski)'
    }
  ];

  return (
    <OverlayModal
      open={open}
      onClose={onClose}
      title={t('main.btn.about')}
      width="950px"
    >
      <div style={{
        padding: '0 60px 60px',
        color: '#f5f5f5',
        textAlign: 'center',
        fontFamily: "'Trajan Pro 3', serif"
      }}>
        {/* Logo Section */}
        <div style={{ marginBottom: '40px' }}>
          <img
            src="./assets/quenching/logo.png"
            alt="Quenching Logo"
            style={{
              width: '160px',
              height: '160px',
              objectFit: 'contain',
              marginBottom: '20px',
              filter: 'drop-shadow(0 0 20px rgba(212, 175, 55, 0.4))'
            }}
          />
          <Title level={2} style={{
            color: '#d4af37',
            margin: 0,
            fontSize: '2.5rem',
            letterSpacing: '4px',
            textShadow: '0 2px 10px rgba(0,0,0,0.5)'
          }}>
            {t('main.title.primary')}
          </Title>
          <Text style={{
            color: '#b8860b',
            fontSize: '1.1rem',
            letterSpacing: '2px',
            display: 'block',
            marginTop: '5px'
          }}>
            {t('main.title.secondary')}
          </Text>
          <Text style={{ color: '#f1ce75', display: 'block', marginTop: 8 }}>{APP_VERSION}</Text>
        </div>

        <Divider style={{ borderColor: 'rgba(212, 175, 55, 0.2)', margin: '30px 0' }} />

        {/* Core Team Section */}
        <div style={{ textAlign: 'center', marginBottom: '50px' }}>
          <Title level={4} style={{ color: '#d4af37', marginBottom: '35px', fontSize: '1.5rem', letterSpacing: '2px' }}>{t('about.team.core')}</Title>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '80px', flexWrap: 'wrap' }}>
            <div>
              <Text style={{ color: '#888', display: 'block', marginBottom: '8px', fontSize: '0.8rem', letterSpacing: '1px' }}>LEAD PRODUCER</Text>
              <Text style={{ color: '#fff', fontSize: '1.3rem', fontWeight: 500, letterSpacing: '1px' }}>Zorrot Chen</Text>
            </div>

            <div>
              <Text style={{ color: '#888', display: 'block', marginBottom: '8px', fontSize: '0.8rem', letterSpacing: '1px' }}>ART DIRECTOR</Text>
              <Text style={{ color: '#fff', fontSize: '1.3rem', fontWeight: 500, letterSpacing: '1px' }}>Jixed</Text>
            </div>

            <div>
              <Text style={{ color: '#888', display: 'block', marginBottom: '8px', fontSize: '0.8rem', letterSpacing: '1px' }}>UI / UX DESIGN</Text>
              <Text style={{ color: '#fff', fontSize: '1.3rem', fontWeight: 500, letterSpacing: '1px' }}>ARON / KANE</Text>
            </div>
          </div>
        </div>

        {/* Community Contributors Section */}
        <div style={{ textAlign: 'center' }}>
          <Title level={4} style={{ color: '#d4af37', marginBottom: '40px', fontSize: '1.5rem', letterSpacing: '2px' }}>{t('about.team.community')}</Title>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '40px', textAlign: 'left', maxWidth: '850px', margin: '0 auto' }}>
            {creditCategories.map((cat, index) => (
              <div key={index} style={{
                background: 'rgba(212, 175, 55, 0.05)',
                padding: '20px 25px',
                borderRadius: '8px',
                borderLeft: '3px solid rgba(212, 175, 55, 0.3)'
              }}>
                <Text style={{
                  color: '#d4af37',
                  display: 'block',
                  marginBottom: '12px',
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  letterSpacing: '1px'
                }}>
                  {cat.title}
                </Text>
                <Paragraph style={{
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: '0.9rem',
                  lineHeight: '1.8',
                  margin: 0,
                  fontFamily: "'Microsoft YaHei', sans-serif" // 列表使用更易读的字体
                }}>
                  {cat.members}
                </Paragraph>
              </div>
            ))}
          </div>
        </div>

        <Divider style={{ borderColor: 'rgba(212, 175, 55, 0.2)', margin: '50px 0' }} />

        {/* Support Section */}
        <div style={{ marginTop: '30px' }}>
          <Title level={3} style={{
            color: '#d4af37',
            marginBottom: '30px',
            fontSize: '1.5rem',
            letterSpacing: '2px'
          }}>
            {t('about.support.title')}
          </Title>
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '60px',
            background: 'rgba(0, 0, 0, 0.3)',
            padding: '40px',
            borderRadius: '12px',
            border: '1px solid rgba(212, 175, 55, 0.1)'
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                padding: '10px',
                background: '#fff',
                borderRadius: '8px',
                marginBottom: '15px',
                boxShadow: '0 0 20px rgba(0,0,0,0.5)'
              }}>
                <img
                  src={qrCode1}
                  alt={qrLabel1}
                  style={{ width: '180px', height: '221px', display: 'block' }}
                />
              </div>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem' }}>{qrLabel1}</Text>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                padding: '10px',
                background: '#fff',
                borderRadius: '8px',
                marginBottom: '15px',
                boxShadow: '0 0 20px rgba(0,0,0,0.5)'
              }}>
                <img
                  src={qrCode2}
                  alt={qrLabel2}
                  style={{ width: '180px', height: '221px', display: 'block' }}
                />
              </div>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem' }}>{qrLabel2}</Text>
            </div>
          </div>
          <Paragraph style={{
            marginTop: '30px',
            color: 'rgba(255,255,255,0.5)',
            fontSize: '0.85rem',
            fontStyle: 'italic'
          }}>
            {t('about.support.desc')}
          </Paragraph>
        </div>

        {/* Links */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '40px' }}>
          <Button
            type="link"
            icon={<GlobalOutlined />}
            onClick={() => {
              playSmall();
              handleOpenLink('https://qm.txzy.net/');
            }}
            onMouseEnter={() => playHover()}
            style={{ color: '#d4af37', fontSize: '1rem' }}
          >
            {t('about.link.website')}
          </Button>
          <Button
            type="link"
            icon={<GithubOutlined />}
            onClick={() => {
              playSmall();
              handleOpenLink('https://github.com/quenching-mod');
            }}
            onMouseEnter={() => playHover()}
            style={{ color: '#d4af37', fontSize: '1rem' }}
          >
            GitHub
          </Button>
          <Button
            type="link"
            icon={<HeartOutlined />}
            onClick={() => {
              playSmall();
              handleOpenLink('https://qm.txzy.net/support');
            }}
            onMouseEnter={() => playHover()}
            style={{ color: '#d4af37', fontSize: '1rem' }}
          >
            {t('about.link.support')}
          </Button>
        </div>

        <div style={{ marginTop: '60px', opacity: 0.3 }}>
          <Text style={{ color: '#fff', fontSize: '0.8rem' }}>
            © 2026 Quenching Mod Team. All rights reserved.
          </Text>
        </div>
      </div>
    </OverlayModal>
  );
};
