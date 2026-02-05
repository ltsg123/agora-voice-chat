import { useRef, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import "./App.css";
import AgoraRTC, {
  IMicrophoneAudioTrack,
  IAgoraRTCClient,
} from "agora-rtc-sdk-ng";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(AgoraRTC as any).setParameter("EXPERIMENTS", {
  // 下行流不销毁参数
  enableAiClientMode: true,
  // 兼容 stt 普通模式
  enableStringuidCompatible: true,
});

AgoraRTC.enableLogUpload();

const client: IAgoraRTCClient = AgoraRTC.createClient({
  mode: "live",
  codec: "vp8",
  role: "audience",
  audioCodec: "opus",
});

let audioTrack: IMicrophoneAudioTrack;

interface HostUser {
  uid: string | number;
  isMuted: boolean;
  isSpeaking: boolean;
}

function App() {
  const [searchParams] = useSearchParams();
  const [isHost, setIsHost] = useState(false); // 是否是主播
  const [isMicMuted, setIsMicMuted] = useState(false); // 麦克风是否静音
  const [isJoined, setIsJoined] = useState(false);
  const [totalUsers, setTotalUsers] = useState(0);
  const [hosts, setHosts] = useState<HostUser[]>([]); // 所有主播列表
  const [showShareModal, setShowShareModal] = useState(false);

  const channel = useRef("voice-chat-room");
  const appid = useRef("");
  const token = useRef("");
  const [showConfig, setShowConfig] = useState(true);
  const isAutoJoining = useRef(false);

  // 从 URL 参数读取配置
  useEffect(() => {
    const urlAppId = searchParams.get("appid");
    const urlToken = searchParams.get("token");
    const urlChannel = searchParams.get("channel");

    if (urlAppId) {
      appid.current = urlAppId;
    }
    if (urlToken) {
      token.current = urlToken;
    }
    if (urlChannel) {
      channel.current = urlChannel;
    }

    // 如果 URL 中有 appid 和 channel，自动加入
    if (urlAppId && urlChannel && !isAutoJoining.current) {
      isAutoJoining.current = true;
      setShowConfig(false);
      setTimeout(() => {
        joinChannel();
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // 监听用户加入
    client.on("user-joined", async () => {
      setTotalUsers((prev) => prev + 1);
    });

    // 监听用户离开
    client.on("user-left", async (user) => {
      setTotalUsers((prev) => prev - 1);
      setHosts((prev) => prev.filter((h) => h.uid !== user.uid));

      // 取消订阅用户的音频
      try {
        if (user.audioTrack) {
          await client.unsubscribe(user, "audio");
          console.log(`取消订阅用户 ${user.uid} 的音频`);
        }
      } catch (error) {
        console.error(`取消订阅用户 ${user.uid} 失败:`, error);
      }
    });

    // 监听用户发布音频
    client.on("user-published", async (user, mediaType) => {
      if (mediaType === "audio") {
        // 预订阅模式：检查是否已有 track 且正在播放
        if (user.audioTrack && user.audioTrack.isPlaying) {
          console.log(
            `[预订阅] 用户 ${user.uid} 发布音频，track 已在播放，忽略`,
          );

          setHosts((prev) =>
            prev.map((h) =>
              h.uid === user.uid
                ? { ...h, isMuted: false, isSpeaking: false }
                : h,
            ),
          );
          return;
        }
        if (user.audioTrack && !user.audioTrack.isPlaying) {
          console.log(
            `[预订阅] 用户 ${user.uid} 发布音频，track 存在但未播放，开始播放`,
          );
          user.audioTrack.play();

          setHosts((prev) =>
            prev.map((h) =>
              h.uid === user.uid
                ? { ...h, isMuted: false, isSpeaking: false }
                : h,
            ),
          );
          return;
        }
        console.log(`[预订阅] 用户 ${user.uid} 发布音频但无 track，补充订阅`);
        await client.presubscribe(user.uid, mediaType);
        const audioTrack = user.audioTrack;
        audioTrack?.play();

        // 添加到主播列表
        setHosts((prev) => {
            return [
              ...prev,
              { uid: user.uid, isMuted: false, isSpeaking: false },
            ];
        });
      }
    });

    // 监听用户取消发布（预订阅模式下不需要取消订阅）
    client.on("user-unpublished", async (user, mediaType) => {
      if (mediaType === "audio") {
        console.log(`用户 ${user.uid} 取消发布音频`);
      }

      // 收到unpublished ,就 mute掉
      setHosts((prev) =>
        prev.map((h) =>
          h.uid === user.uid ? { ...h, isMuted: true, isSpeaking: false } : h,
        ),
      );
    });

    return () => {
      client.removeAllListeners();
    };
  }, []);

  const joinChannel = async () => {
    if (!appid.current) {
      alert("请输入 App ID");
      return;
    }

    // 检查是否已经在频道中
    if (
      client.connectionState === "CONNECTED" ||
      client.connectionState === "CONNECTING"
    ) {
      console.log("已经在频道中或正在连接");
      setIsJoined(true);
      setShowConfig(false);
      return;
    }

    try {
      await client.join(
        appid.current,
        channel.current,
        token.current || null,
        "random-user-" + Math.random().toString(36).substring(2, 15),
      );

      setIsJoined(true);
      setShowConfig(false);
      setTotalUsers(client.remoteUsers.length + 1);
    } catch (error) {
      console.error("加入频道失败:", error);
      alert("加入频道失败，请检查配置");
      setShowConfig(true);
      isAutoJoining.current = false;
    }
  };

  const leaveChannel = async () => {
    // 如果是主播，先下麦
    if (isHost) {
      await becomeAudience();
    }

    await client.leave();
    setIsJoined(false);
    setTotalUsers(0);
    setHosts([]);
    setShowConfig(true);
    isAutoJoining.current = false;
  };

  // 成为主播（上麦）
  const becomeHost = async () => {
    if (!isJoined) {
      await joinChannel();
    }

    try {
      // 设置客户端角色为主播
      await client.setClientRole("host");

      // 创建麦克风音频轨道
      audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
      // 默认静音
      await audioTrack.setMuted(false);
      // 发布音频流
      await client.publish(audioTrack);

      setIsHost(true);
      setIsMicMuted(false);

      // 将自己添加到主播列表
      setHosts((prev) => [
        ...prev,
        { uid: client.uid!, isMuted: false, isSpeaking: false },
      ]);

      console.log("成为主播成功");
    } catch (error) {
      console.error("成为主播失败:", error);
      alert("成为主播失败，请检查麦克风权限");
    }
  };

  // 成为观众（下麦）
  const becomeAudience = async () => {
    try {
      if (audioTrack) {
        await client.unpublish(audioTrack);
        audioTrack.close();
      }

      // 设置客户端角色为观众
      await client.setClientRole("audience");

      setIsHost(false);
      setIsMicMuted(true);

      // 从主播列表中移除自己
      setHosts((prev) => prev.filter((h) => h.uid !== client.uid));

      console.log("成为观众成功");
    } catch (error) {
      console.error("成为观众失败:", error);
    }
  };

  // 切换麦克风静音状态
  const toggleMic = async () => {
    if (!isHost || !audioTrack) {
      return;
    }

    const newMutedState = !isMicMuted;
    await audioTrack.setMuted(newMutedState);
    setIsMicMuted(newMutedState);

    // 更新自己的状态
    setHosts((prev) =>
      prev.map((h) =>
        h.uid === client.uid ? { ...h, isMuted: newMutedState } : h,
      ),
    );
  };

  const generateShareLink = () => {
    const baseUrl = window.location.origin + window.location.pathname;
    const params = new URLSearchParams({
      appid: appid.current,
      channel: channel.current,
    });
    if (token.current) {
      params.append("token", token.current);
    }
    return `${baseUrl}?${params.toString()}`;
  };

  const copyShareLink = () => {
    const link = generateShareLink();
    navigator.clipboard.writeText(link).then(() => {
      alert("分享链接已复制到剪贴板！");
      setShowShareModal(false);
    });
  };

  return (
    <div className="voice-chat-container">
      {/* 右上角显示总人数 */}
      {isJoined && (
        <div className="user-count">
          <span className="count-icon">👥</span>
          <span className="count-number">{totalUsers}</span>
        </div>
      )}

      {/* 配置面板 */}
      {showConfig && (
        <div className="config-panel">
          <h2>语聊房配置</h2>
          <div className="config-form">
            <input
              defaultValue={appid.current}
              placeholder="请输入 App ID"
              onChange={(e) => (appid.current = e.target.value)}
            />
            <input
              defaultValue={token.current}
              placeholder="请输入 Token（可选）"
              onChange={(e) => (token.current = e.target.value)}
            />
            <input
              defaultValue={channel.current}
              placeholder="请输入频道名称"
              onChange={(e) => (channel.current = e.target.value)}
            />
            <button onClick={joinChannel} className="join-btn">
              加入语聊房
            </button>
          </div>
        </div>
      )}

      {/* 主界面 */}
      {isJoined && (
        <>
          <div className="room-header">
            <h1>语聊房：{channel.current}</h1>
            <button
              className="share-button"
              onClick={() => setShowShareModal(true)}
            >
              📤 分享房间
            </button>
          </div>

          {/* 主播列表 */}
          <div className="speakers-container">
            {hosts.length === 0 ? (
              <div className="empty-state">暂无主播上麦</div>
            ) : (
              <div className="speakers-grid">
                {hosts.map((host) => (
                  <div
                    key={host.uid}
                    className={`speaker-card ${
                      host.isSpeaking ? "speaking" : ""
                    }`}
                  >
                    <div className="speaker-avatar">
                      <span className="avatar-icon">🎤</span>
                      {/* 麦克风状态指示器 */}
                      <div
                        className={`mic-status ${host.isMuted ? "muted" : "unmuted"}`}
                      >
                        {host.isMuted ? "🔇" : "🎙️"}
                      </div>
                    </div>
                    <div className="speaker-info">
                      <div className="speaker-name">
                        {host.uid === client.uid ? "我" : `主播 ${host.uid}`}
                      </div>
                      <div className="speaker-status">
                        {host.isSpeaking ? (
                          <span className="status-speaking">🔊 正在说话</span>
                        ) : host.isMuted ? (
                          <span className="status-muted">🔇 已闭麦</span>
                        ) : (
                          <span className="status-unmuted">🎙️ 已开麦</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 底部控制栏 */}
          <div className="control-bar">
            {!isHost ? (
              // 观众状态：显示上麦按钮
              <button onClick={becomeHost} className="host-button">
                <span className="button-icon">🎤</span>
                <span className="button-text">成为主播</span>
              </button>
            ) : (
              // 主播状态：显示开麦/闭麦和下麦按钮
              <div className="host-controls">
                <button
                  onClick={toggleMic}
                  className={`mic-toggle-button ${
                    isMicMuted ? "muted" : "unmuted"
                  }`}
                >
                  <span className="button-icon">
                    {isMicMuted ? "🔇" : "🎙️"}
                  </span>
                  <span className="button-text">
                    {isMicMuted ? "开麦" : "闭麦"}
                  </span>
                </button>
                <button onClick={becomeAudience} className="audience-button">
                  <span className="button-icon">👤</span>
                  <span className="button-text">下麦</span>
                </button>
              </div>
            )}
            <button onClick={leaveChannel} className="leave-button">
              离开房间
            </button>
          </div>
        </>
      )}

      {/* 分享弹窗 */}
      {showShareModal && (
        <div className="modal-overlay" onClick={() => setShowShareModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>分享语聊房</h3>
            <div className="share-link-container">
              <input
                type="text"
                value={generateShareLink()}
                readOnly
                className="share-link-input"
              />
            </div>
            <div className="modal-buttons">
              <button onClick={copyShareLink} className="copy-button">
                复制链接
              </button>
              <button
                onClick={() => setShowShareModal(false)}
                className="cancel-button"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
