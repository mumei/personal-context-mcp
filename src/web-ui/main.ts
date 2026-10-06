/**
 * Provides main capabilities for the web UI layer.
 * Responsibility: This module owns the main behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * Web UI層のmain機能を提供します。
 * 責務: このモジュールは、ここで宣言するmainの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import { createApp } from "vue";
import App from "#webUi/App.vue";
import { router } from "#webUi/router";
import { i18n } from "#webUi/i18n";
import "./styles/tokens.css";
import "./styles/base.css";

createApp(App).use(router).use(i18n).mount("#app");
