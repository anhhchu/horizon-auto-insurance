import { createApp, analytics, genie, lakebase, server } from '@databricks/appkit';
import { setupUnderwritingRoutes } from './routes/underwriting-routes';

createApp({
  plugins: [
    analytics(),
    genie(),
    lakebase(),
    server(),
  ],
  async onPluginsReady(appkit) {
    await setupUnderwritingRoutes(appkit);
  },
}).catch(console.error);
