import React, { useState, useEffect } from 'react';
import { Typography, Button, Checkbox, Row, Col, message } from 'antd';
import { useTranslation } from '../../utils/i18n';
import { OverlayModal } from './OverlayModal';
import { useSound } from '../../hooks/useSound';
import { resolveThemeMedia, reportThemeMediaError } from '../../utils/theme-media';

const { Text } = Typography;

interface ThemeModalProps {
  open: boolean;
  onClose: () => void;
}

interface Theme {
  id: string;
  name: string;
  description: string;
  video: string; // 将 preview 替换为 video
  author?: string;
}

const themes: Theme[] = [
  {
    id: 'magicstorm',
    name: '魔法风暴',
    description: '全新的魔法风暴主界面背景',
    video: 'assets/quenching/magicstorm.mp4',
    author: 'QuenchinG'
  },
  {
    id: 'roc',
    name: '混乱之治',
    description: '经典的混乱之治主界面，回溯一切开始的地方',
    video: 'assets/quenching/mainmenu1.mp4',
    author: 'Blizzard Entertainment'
  },
  {
    id: 'tft',
    name: '冰封王座',
    description: '经典的冰封王座主界面，感受北地寒风的凛冽',
    video: 'assets/quenching/mainmenu0.mp4',
    author: 'Blizzard Entertainment'
  },
  {
    id: 'quenching',
    name: '淬火主题',
    description: '专为淬火 MOD 设计的现代化主题，带来极致视觉享受',
    video: 'assets/quenching/mainmenu2.mp4',
    author: 'Aron/Zorrot'
  },
  {
    id: 'warcraft2',
    name: '魔兽2主题',
    description: '怀旧的魔兽争霸 II 风格设计，重温经典岁月',
    video: 'assets/quenching/mainmenu3.mp4',
    author: 'Community'
  },
  {
    id: 'city',
    name: '城邦主题',
    description: '华丽的城邦风格设计，展现宏伟建筑之美',
    video: 'assets/quenching/mainmenu4.mp4',
    author: 'Design Team'
  },
  {
    id: 'plaguelands',
    name: '瘟疫之地',
    description: '被瘟疫笼罩的土地，亡灵天灾的领地',
    video: 'assets/quenching/mainmenu5.mp4',
    author: 'Community'
  }
];

export const ThemeModal: React.FC<ThemeModalProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const { playSmall, playHover } = useSound();
  const [messageApi, contextHolder] = message.useMessage();

  const resolveVideo = (src: string) => src ? resolveThemeMedia(src,document.baseURI) : '';
  const [selectedTheme, setSelectedTheme] = useState('magicstorm');
  const [hoveredTheme, setHoveredTheme] = useState<Theme | null>(null);
  const [customThemes, setCustomThemes] = useState<Theme[]>([]);
  const [applyToGame, setApplyToGame] = useState(true);
  const [applying, setApplying] = useState(false);

  // 初始化加载配置
  useEffect(() => {
    if (open) {
      const loadConfig = async () => {
        const savedTheme = await window.electronAPI?.getConfig('theme');
        if (savedTheme) {
          setSelectedTheme(savedTheme);
        }
        setApplyToGame((await window.electronAPI?.getConfig('themeApplyToGame')) !== false);
        const savedCustomThemes = await window.electronAPI?.getConfig('customThemes');
        if (savedCustomThemes && Array.isArray(savedCustomThemes)) {
          setCustomThemes(savedCustomThemes);
        }
      };
      loadConfig();
    }
  }, [open]);

  // 合并所有主题
  const allThemes = [...themes, ...customThemes];

  const handleApplyTheme = async () => {
    const key = 'applyTheme';
    setApplying(true);
    messageApi.loading({ content: t('theme.updating'), key });

    try {
      // 1. 立即更新 App 内部配置（即便游戏目录不对，App 也要换装）
      await window.electronAPI?.setConfig('theme', selectedTheme);
      await window.electronAPI?.setConfig('themeApplyToGame', applyToGame);

      // 立即触发 App 内的主题变更事件，让背景视频刷新
      window.dispatchEvent(new CustomEvent('theme-changed', { detail: selectedTheme }));

      // 2. 尝试应用到游戏文件
      const success = !applyToGame || await window.electronAPI?.applyTheme(selectedTheme);

      if (success) {
        messageApi.success({ content: t('msg.settings.updated'), key });
        onClose();
      } else {
        // 如果失败，只给一个警告提示，但不影响 App 已经切换的主题
        messageApi.warning({
          content: t('theme.apply.failed') || '主题文件未能成功应用到游戏目录',
          key,
          duration: 4
        });
        // 依然可以关闭窗口，因为 App 内部已经切换了
        onClose();
      }
    } catch (error) {
      console.error('Failed to apply theme:', error);
      messageApi.error({ content: t('msg.mod.failed'), key });
    } finally {
      setApplying(false);
    }
  };

  const handleAddCustomTheme = async () => {
    try {
      const result = await window.electronAPI?.selectFile({
        title: '选择自定义主题视频',
        filters: [
          { name: 'Video Files', extensions: ['webm', 'mp4', 'avi'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (result) {
        const newTheme: Theme & { videoPath: string } = {
          id: `custom-${Date.now()}`,
          name: `${t('theme.custom')} ${customThemes.length + 1}`,
          description: t('theme.custom'),
          video: result, // 直接使用视频路径
          author: 'Me',
          videoPath: result
        };
        const updatedCustom = [...customThemes, newTheme];
        setCustomThemes(updatedCustom);
        await window.electronAPI?.setConfig('customThemes', updatedCustom);
        messageApi.success(t('theme.btn.add.success' as any) || '添加自定义主题成功');
      }
    } catch (error) {
      console.error('Failed to add custom theme:', error);
    }
  };

  const handleDeleteCustomTheme = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedCustom = customThemes.filter(t => t.id !== id);
    setCustomThemes(updatedCustom);
    await window.electronAPI?.setConfig('customThemes', updatedCustom);
    if (selectedTheme === id) {
      setSelectedTheme('quenching');
    }
    messageApi.success(t('theme.btn.delete.success' as any) || '主题已删除');
  };

  // 这里的 currentTheme 用于底部详情显示
  const displayTheme = hoveredTheme || allThemes.find(t => t.id === selectedTheme) || themes[0];
  // 这里的 backgroundTheme 仅用于背景，不随 hover 改变
  const backgroundTheme = allThemes.find(t => t.id === selectedTheme) || themes[0];

  if (!open) return null;

  return (
    <OverlayModal
      title={t('main.btn.theme')}
      open={open}
      onClose={onClose}
      width="90%"
    >
      {contextHolder}
      <div className="theme-modal-content" style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        minHeight: '100%'
      }}>
        {/* 背景预览图 - 仅随选中的主题改变 */}
        <video
          key={backgroundTheme.id}
          onError={event => reportThemeMediaError(event.currentTarget)}
          autoPlay
          muted
          loop
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: 0.3,
            transition: 'all 0.5s ease',
            zIndex: 0
          }}
          src={resolveVideo(backgroundTheme.video)}
        />

        {/* 内容区域 */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1,
          padding: '40px'
        }}>
          <div style={{ flex: 1 }}>
            <Row gutter={[30, 30]}>
              {allThemes.map((theme) => (
                <Col span={6} key={theme.id}>
                  <div
                    onClick={() => {
                      playSmall();
                      setSelectedTheme(theme.id);
                    }}
                    onMouseEnter={() => {
                      playHover();
                      setHoveredTheme(theme);
                    }}
                    onMouseLeave={() => setHoveredTheme(null)}
                    style={{
                      position: 'relative',
                      cursor: 'pointer',
                      border: selectedTheme === theme.id ? '2px solid #d4af37' : '2px solid rgba(212, 175, 55, 0.2)',
                      borderRadius: '12px',
                      overflow: 'hidden',
                      transition: 'all 0.3s',
                      transform: selectedTheme === theme.id ? 'translateY(-5px)' : 'none',
                      boxShadow: selectedTheme === theme.id ? '0 10px 20px rgba(0,0,0,0.5), 0 0 15px rgba(212, 175, 55, 0.3)' : '0 4px 10px rgba(0,0,0,0.3)',
                      background: 'rgba(20, 20, 20, 0.8)'
                    }}
                  >
                    <div style={{
                      height: '160px',
                      overflow: 'hidden',
                      position: 'relative',
                      background: '#000'
                    }}>
                      <video
                        src={resolveVideo(theme.video)}
                        muted
                        loop
                        preload="none"
                        onError={event => reportThemeMediaError(event.currentTarget)}
                        onMouseEnter={(e) => {
                          const video = e.currentTarget;
                          video.play().catch(err => {
                            if (err.name !== 'AbortError') {
                              console.error('Video play failed:', err);
                            }
                          });
                        }}
                        onMouseLeave={(e) => {
                          const video = e.currentTarget;
                          video.pause();
                          video.currentTime = 0;
                        }}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block'
                        }}
                      />
                    </div>
                    <div style={{
                      padding: '12px',
                      background: 'linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.7))',
                      color: selectedTheme === theme.id ? '#d4af37' : '#fff',
                      textAlign: 'center',
                      fontFamily: "'Trajan Pro 3', serif",
                      fontSize: '1rem'
                    }}>
                      {theme.id.startsWith('custom-') ? theme.name : t(`theme.${theme.id}.name` as any)}
                    </div>

                    {/* 选中标识 */}
                    {selectedTheme === theme.id && (
                      <div style={{
                        position: 'absolute',
                        top: '12px',
                        left: '12px',
                        background: '#d4af37',
                        color: '#000',
                        borderRadius: '4px',
                        padding: '2px 8px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        fontFamily: "'Trajan Pro 3', serif"
                      }}>
                        {t('theme.status.active')}
                      </div>
                    )}

                    {/* 删除按钮 (仅限自定义主题) */}
                    {theme.id.startsWith('custom-') && (
                      <div
                        onClick={(e) => handleDeleteCustomTheme(theme.id, e)}
                        style={{
                          position: 'absolute',
                          top: '8px',
                          right: '8px',
                          width: '24px',
                          height: '24px',
                          background: 'rgba(255,0,0,0.6)',
                          color: '#fff',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '14px',
                          opacity: hoveredTheme?.id === theme.id ? 1 : 0,
                          transition: 'opacity 0.3s',
                          zIndex: 10
                        }}
                      >
                        ✕
                      </div>
                    )}
                  </div>
                </Col>
              ))}

              {/* 添加自定义主题按钮 */}
              <Col span={6}>
                <div
                  onClick={handleAddCustomTheme}
                  style={{
                    height: '206px',
                    border: '2px dashed rgba(212, 175, 55, 0.4)',
                    borderRadius: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.3s',
                    background: 'rgba(212, 175, 55, 0.05)',
                    color: 'rgba(212, 175, 55, 0.6)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#d4af37';
                    e.currentTarget.style.color = '#d4af37';
                    e.currentTarget.style.background = 'rgba(212, 175, 55, 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(212, 175, 55, 0.4)';
                    e.currentTarget.style.color = 'rgba(212, 175, 55, 0.6)';
                    e.currentTarget.style.background = 'rgba(212, 175, 55, 0.05)';
                  }}
                >
                  <div style={{ fontSize: '48px', marginBottom: '10px' }}>+</div>
                  <div style={{ fontFamily: "'Trajan Pro 3', serif" }}>{t('theme.btn.add')}</div>
                </div>
              </Col>
            </Row>
          </div>

          {/* 底部详情与应用按钮 */}
          <div style={{
            marginTop: '40px',
            padding: '25px 40px',
            background: 'linear-gradient(180deg, rgba(30,30,30,0.9) 0%, rgba(10,10,10,0.95) 100%)',
            border: '1px solid rgba(212, 175, 55, 0.3)',
            borderRadius: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '24px',
            boxShadow: '0 -10px 30px rgba(0,0,0,0.5)'
          }}>
            <div style={{ flex: 1 }}>
              <h4 style={{
                color: '#d4af37',
                fontSize: '1.5rem',
                marginBottom: '8px',
                fontFamily: "'Trajan Pro 3', serif",
                textShadow: '0 2px 4px rgba(0,0,0,0.8)'
              }}>
                {displayTheme.id.startsWith('custom-') ? displayTheme.name : t(`theme.${displayTheme.id}.name` as any)}
              </h4>
              <Text style={{ color: '#ccc', fontSize: '1rem', lineHeight: '1.5' }}>
                {displayTheme.id.startsWith('custom-') ? displayTheme.description : t(`theme.${displayTheme.id}.desc` as any)}
              </Text>
              {displayTheme.author && (
                <div style={{ color: '#888', fontSize: '0.9rem', marginTop: '8px' }}>
                  {t('theme.author.prefix') || 'BY:'} {displayTheme.author}
                </div>
              )}
            </div>
            <div className="theme-modal-actions" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '20px' }}>
              <Checkbox checked={applyToGame} disabled={applying} onChange={event => setApplyToGame(event.target.checked)}
                style={{ color: '#d4af37', whiteSpace: 'nowrap' }}>
                {t('theme.applyToGame')}
              </Checkbox>
              <Button
                type="primary"
                size="large"
                loading={applying}
                onClick={() => {
                  playSmall();
                  handleApplyTheme();
                }}
                onMouseEnter={() => playHover()}
                style={{
                  background: 'linear-gradient(180deg, #f0d060 0%, #d4af37 100%)',
                  borderColor: '#b8962d',
                  color: '#000',
                  fontWeight: '900',
                  height: '56px',
                  padding: '0 60px',
                  fontSize: '1.2rem',
                  fontFamily: "'Trajan Pro 3', serif",
                  borderRadius: '4px',
                  boxShadow: '0 4px 15px rgba(212, 175, 55, 0.4)'
                }}
              >
                {t('theme.btn.apply')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </OverlayModal>
  );
};
