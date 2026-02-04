# 语聊房项目

基于 Agora RTC SDK NG 的语音聊天室应用，支持主播模式和观众模式，采用预订阅策略实现最低延迟。

## 功能特性

- 🎤 **主播模式**：成为主播后可以发布音频流
- 🔇 **开麦/闭麦**：主播可以控制麦克风的开关状态
- 👥 **实时显示频道总人数**：包括主播和观众
- 🎙️ **主播列表**：显示所有上麦的主播
- 📊 **状态指示**：实时显示主播的麦克风状态和说话状态
- 🔗 **分享链接**：快速生成分享链接邀请他人加入
- 🌐 **URL 参数自动配置**：通过链接自动加入房间
- ⚡ **预订阅优化**：采用预订阅策略，实现最低首帧延迟

## Agora RTC SDK NG 集成详解

### 1. SDK 初始化

```typescript
import AgoraRTC, {
  IMicrophoneAudioTrack,
  IAgoraRTCClient,
} from "agora-rtc-sdk-ng";

// 配置实验性参数
(AgoraRTC as any).setParameter("EXPERIMENTS", {
  // 启用 AI 客户端模式：下行流不销毁，优化订阅体验
  enableAiClientMode: true,
  // 启用字符串 UID 兼容模式：兼容 STT（语音转文字）普通模式
  enableStringuidCompatible: true,
});

// 创建客户端实例
const client: IAgoraRTCClient = AgoraRTC.createClient({
  mode: "live", // 直播模式（区分主播和观众）
  codec: "vp8", // 视频编码格式
  role: "audience", // 默认角色为观众
  audioCodec: "opus", // 音频编码格式
});
```

**实验性参数说明**：

- `enableAiClientMode`: 启用后，保持下行流不销毁，优化订阅和播放体验，特别适合预订阅场景
- `enableStringuidCompatible`: 启用 支持与 STT 普通模式集成

### 2. 加入频道

```typescript
await client.join(
  appid, // Agora App ID
  channel, // 频道名称
  token || null, // Token（可选）
  "random-user-" + uid, // 用户 UID（随机生成）
);
```

### 3. 角色切换与音频发布

#### 成为主播（上麦）

```typescript
// 1. 切换角色为主播
await client.setClientRole("host");

// 2. 创建麦克风音频轨道
const audioTrack = await AgoraRTC.createMicrophoneAudioTrack();

// 3. 默认静音（避免误开麦）
audioTrack.setMuted(true);

// 4. 发布音频流到频道
await client.publish(audioTrack);
```

#### 控制麦克风

```typescript
// 开麦/闭麦
await audioTrack.setMuted(isMuted);
```

#### 下麦（成为观众）

```typescript
// 1. 取消发布音频流
await client.unpublish(audioTrack);

// 2. 关闭音频轨道
audioTrack.close();

// 3. 切换角色为观众
await client.setClientRole("audience");
```

### 4. 订阅策略（预订阅模式）

本项目采用预订阅模式，实现最低延迟和最佳用户体验：

```typescript
// user-joined 事件：用户加入时立即预订阅
client.on("user-joined", async (user) => {
  try {
    // 预订阅音频流
    await client.presubscribe(user.uid, "audio");

    // 直接播放（如果有音频轨道）
    const audioTrack = user.audioTrack;
    audioTrack?.play();
  } catch (error) {
    console.error("预订阅失败:", error);
  }
});

// user-published 事件：检查 track 状态，确保播放
client.on("user-published", async (user, mediaType) => {
  if (mediaType === "audio") {
    // 检查是否已有 track 且正在播放
    if (user.audioTrack && user.audioTrack.isPlaying) {
      console.log("track 已在播放，忽略");
      return;
    }

    // track 存在但未播放，开始播放
    if (user.audioTrack && !user.audioTrack.isPlaying) {
      console.log("track 存在但未播放，开始播放");
      user.audioTrack.play();
      return;
    }

    // track 不存在，补充订阅
    console.log("无 track，补充订阅");
    await client.subscribe(user, mediaType);
    user.audioTrack?.play();
  }
});
```

**预订阅模式的优势**：

- **更低延迟**：用户加入时即建立连接，无需等待 `user-published` 事件
- **更好体验**：主播开麦后观众能立即听到声音
- **智能容错**：
  - 预订阅成功 → 直接播放
  - track 存在但未播放 → 自动调用 `play()`
  - track 不存在 → 自动降级补充订阅
- **生产就绪**：经过完善的边界情况处理，适合生产环境

### 5. 事件监听

#### 用户加入/离开

```typescript
// 用户加入
client.on("user-joined", async (user) => {
  setTotalUsers((prev) => prev + 1);

  // 立即预订阅
  await client.presubscribe(user.uid, "audio");
});

// 用户离开
client.on("user-left", async (user) => {
  setTotalUsers((prev) => prev - 1);

  // 取消订阅音频
  if (user.audioTrack) {
    await client.unsubscribe(user, "audio");
  }
});
```

#### 音量检测

```typescript
// 启用音量指示器
client.enableAudioVolumeIndicator();

// 监听音量变化
client.on("volume-indicator", (volumes) => {
  volumes.forEach((volume) => {
    if (volume.level > 10) {
      // 正在说话
      updateHostStatus(volume.uid, { isMuted: false, isSpeaking: true });
    } else if (volume.level > 0) {
      // 开麦但未说话
      updateHostStatus(volume.uid, { isMuted: false, isSpeaking: false });
    }
  });
});
```

### 6. 离开频道

```typescript
// 如果是主播，先下麦
if (isHost) {
  await becomeAudience();
}

// 离开频道
await client.leave();

// 清理状态
setIsJoined(false);
setTotalUsers(0);
setHosts([]);
```

### 最佳实践总结

本项目采用预订阅模式，配合实验性参数优化，实现了：

- **最低首帧延迟**：用户加入时即建立连接
- **智能容错机制**：自动处理各种边界情况
- **生产级稳定性**：经过完善测试，适合生产环境
- **最佳用户体验**：主播开麦后观众立即听到声音
