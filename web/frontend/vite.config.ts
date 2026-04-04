import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		proxy: {
			"/ws": {
				target: "ws://localhost:8100",
				ws: true,
				changeOrigin: true,
			},
			"/api": {
				target: "http://localhost:8100",
				changeOrigin: true,
			},
		},
	},
});
