/*
 * @Author: ltsg xiaoshumin@agora.io
 * @Date: 2024-07-16 16:59:35
 * @LastEditors: ltsg xiaoshumin@agora.io
 * @LastEditTime: 2026-02-04 10:15:44
 * @FilePath: /agora-voice-chat/vite.config.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    https: {
      key: "/Users/config/key.pem",
      cert: "/Users/config/cert.pem",
    },
  },
});
