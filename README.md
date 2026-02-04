# 语聊房项目

基于 Agora RTC SDK NG 的语音聊天室应用，支持主播模式和观众模式，采用预订阅策略实现最低延迟。

## ⚠️ 重要注意事项

### 必需的参数配置

在使用预订阅模式前，**必须**先配置以下参数：

```typescript
(AgoraRTC as any).setParameter("EXPERIMENTS", {
  // 启用后，保持下行流不销毁，优化订阅和播放体验
  enableAiClientMode: true,
  // 启用后，支持与 STT 普通模式集成
  enableStringuidCompatible: true,
});
```

**参数说明**：

- **`enableAiClientMode`**: 保持下行流不销毁，特别适合预订阅场景，避免流的重复创建和销毁
- **`enableStringuidCompatible`**: 支持与 STT（语音转文字）普通模式集成

⚡ **这两个参数对于实现低延迟预订阅至关重要，建议在生产环境中启用。**

### 集成重点

**控制麦克风状态时的注意事项**：

- ✅ **正确做法**：使用 `audioTrack.setMuted(true/false)` 控制麦克风开关
- ❌ **错误做法**：不要在 `setMuted` 时调用 `publish()`/`unpublish()` 流

### 特殊的事件集成方式

预订阅模式需要特殊的事件处理逻辑，与传统订阅模式不同：

| 事件                            | 操作                      | 说明                                   |
| ------------------------------- | ------------------------- | -------------------------------------- |
| **user-joined** (主播上线)      | ✅ 调用 `presubscribe()`  | 主播加入时立即预订阅，建立连接         |
| **user-left** (主播下线)        | ✅ 调用 `unsubscribe()`   | 主播离开时才取消订阅，释放资源         |
| **user-published** (发布流)     | ⚠️ 校验复用               | 检查是否已有流，有则复用，无则补充订阅 |
| **user-unpublished** (取消发布) | ❌ 不调用 `unsubscribe()` | 保持订阅状态，等待主播重新发布         |

**关键要点**：

- 订阅的生命周期绑定到**主播在线状态**（观众没有状态，不触发这些事件）
- `user-published` 时优先复用已有的流，避免重复订阅
- `user-unpublished` 时保持订阅，减少主播闭麦/开麦时的重连开销

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

// 创建客户端实例
const client: IAgoraRTCClient = AgoraRTC.createClient({
  mode: "live", // 直播模式（区分主播和观众）
  codec: "vp8", // 视频编码格式
  role: "audience", // 默认角色为观众
  audioCodec: "opus", // 音频编码格式
});
```

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

本项目采用预订阅模式，订阅生命周期绑定到主播在线状态：

```typescript
// user-joined 事件：主播上线时立即预订阅
client.on("user-joined", async (user) => {
  try {
    // 预订阅音频流（建立连接）
    await client.presubscribe(user.uid, "audio");

    // 如果已有音频轨道，直接播放
    const audioTrack = user.audioTrack;
    audioTrack?.play();
  } catch (error) {
    console.error("预订阅失败:", error);
  }
});

// user-left 事件：主播下线时才取消订阅
client.on("user-left", async (user) => {
  setTotalUsers((prev) => prev - 1);

  // 主播离开时取消订阅，释放资源
  if (user.audioTrack) {
    await client.unsubscribe(user, "audio");
  }
});

// user-published 事件：校验并复用已有流
client.on("user-published", async (user, mediaType) => {
  if (mediaType === "audio") {
    // 检查是否已有 track 且正在播放
    if (user.audioTrack && user.audioTrack.isPlaying) {
      console.log("track 已在播放，复用现有流");
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
    await client.presubscribe(user.uid, mediaType);
    user.audioTrack?.play();
  }
});

// user-unpublished 事件：不取消订阅，保持连接
client.on("user-unpublished", async (user, mediaType) => {
  if (mediaType === "audio") {
    console.log("主播取消发布，但保持订阅状态");
    // 注意：这里不调用 unsubscribe()
    // 保持订阅状态，等待主播重新发布，减少重连开销
  }
});
```

**预订阅模式的核心原则**：

1. **订阅时机**：
   - ✅ `user-joined` 时调用 `presubscribe()` - 主播上线立即建立连接
   - ❌ 不在 `user-published` 时订阅 - 避免重复订阅

2. **取消订阅时机**：
   - ✅ `user-left` 时调用 `unsubscribe()` - 主播下线才释放资源
   - ❌ 不在 `user-unpublished` 时取消订阅 - 保持连接，等待重新发布

3. **流复用策略**：
   - 优先复用已有的 track，避免重复创建
   - 只在 track 不存在时才补充订阅

### 5. 事件监听

#### 用户加入/离开

```typescript
// 用户加入：立即预订阅
client.on("user-joined", async (user) => {
  setTotalUsers((prev) => prev + 1);

  // 立即预订阅（建立连接）
  await client.presubscribe(user.uid, "audio");
});

// 用户离开：取消订阅
client.on("user-left", async (user) => {
  setTotalUsers((prev) => prev - 1);

  // 用户离开时才取消订阅
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
