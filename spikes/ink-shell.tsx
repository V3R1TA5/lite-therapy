import { render } from 'ink';
import { AppService } from '../src/services/appService.js';
import { App } from '../src/ui/App.js';

const service = new AppService();
const instance = render(<App service={service} />, {
  alternateScreen: true,
  exitOnCtrlC: false,
  maxFps: 30,
});

await instance.waitUntilExit();
service.shutdown();
