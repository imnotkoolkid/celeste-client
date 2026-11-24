# Celeste Client - #1 most performant kirka client

[CLICK TO DOWNLOAD](https://github.com/imnotkoolkid/celeste-client/releases/latest)

>Facing any issues or have suggestions? Feel free to reach out [here](https://discord.com/users/841926384838115358)

## Features

-  Uncapped FPS 
-  Custom Frame Cap 
-  Resource Swapper 
-  Custom Skin 
-  Custom User CSS 
-  Custom User Scripts 
-  Keystroke Overlay
-  Custom Hitmarkers 
-  Custom Kill Icons 
-  In-Game UI Customizer 
-  Game Chat Modes 
-  ANGLE Graphics Backend 
-  Built-in Proxy and Mask IP 
-  Incognito Mode
-  Discord Rich Presence 
-  And More

## Default Keybinds

| Keybind | Action |
| --- | --- |
| Right Shift | Toggle Client Menu |
| F3 | Copy Current Game URL |
| F4 | Return to Main Lobby |
| F5 | Reload Page |
| F11 | Toggle Fullscreen |
| F12 / Ctrl+Shift+I | Open Developer Tools |
| Ctrl+Shift+R | Quick Restart Client |
| Ctrl+Shift+N | Open Incognito Window |
| + | Zoom In |
| - | Zoom Out |
| 0 | Reset Zoom |

## Build Instructions

### Prerequisites
- Node.js (version 20.x or newer recommended)
- Git

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/imnotkoolkid/celeste-client.git
   cd celeste-client
   ```

2. Install dependencies:
   ```bash
   npm install
   ```
   During installation, the postinstall script automatically downloads the patched Electron v44 runtime for your operating system.

### Running in Development

To start the client in development mode:
```bash
npm start
```

### Packaging for Production

To build standalone packages for your current operating system:
```bash
npm run build
```
Compiled installers and executables will be placed in the `dist` directory.

