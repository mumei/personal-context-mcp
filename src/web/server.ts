/**
 * Provides the stable public facade for the Web monitor implementation.
 * Webモニター実装の安定した公開ファサードを提供します。
 *
 * @remarks
 * This module only re-exports Web contracts and does not implement HTTP or application behavior.
 * このモジュールはWeb契約の再exportだけを行い、HTTP処理やアプリケーション処理は実装しません。
 *
 * @packageDocumentation
 */
export * from "#web/types";
export * from "#web/application";
export * from "#web/ui/staticAssets";
export * from "#web/http/server";
