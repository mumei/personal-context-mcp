<script setup lang="ts">
import { ArrowRight, BookOpenText, Brain, FileText, ListChecks, ShieldCheck } from "@lucide/vue";
import { useLocale } from "#webUi/composables/useLocale";

const { t } = useLocale();
</script>

<template>
  <div class="help-page">
    <header class="page-heading">
      <div>
        <h2>{{ t("helpIntroTitle") }}</h2>
        <p>{{ t("helpIntroBody") }}</p>
      </div>
    </header>

    <section class="help-section">
      <h3>{{ t("helpPrinciplesTitle") }}</h3>
      <div class="principles">
        <article>
          <ShieldCheck :size="22" />
          <div>
            <h4>{{ t("helpLocalTitle") }}</h4>
            <p>{{ t("helpLocalBody") }}</p>
          </div>
        </article>
        <article>
          <BookOpenText :size="22" />
          <div>
            <h4>{{ t("helpSeparationTitle") }}</h4>
            <p>{{ t("helpSeparationBody") }}</p>
          </div>
        </article>
        <article>
          <Brain :size="22" />
          <div>
            <h4>{{ t("helpClientTitle") }}</h4>
            <p>{{ t("helpClientBody") }}</p>
          </div>
        </article>
      </div>
    </section>

    <section class="help-section">
      <h3>{{ t("helpFlowTitle") }}</h3>
      <p class="section-lead">{{ t("helpFlowBody") }}</p>
      <div class="data-flow" :aria-label="t('helpFlowTitle')">
        <div>
          <BookOpenText :size="20" /><strong>Activity</strong><span>{{ t("helpActivityShort") }}</span>
        </div>
        <ArrowRight class="flow-arrow" :size="20" />
        <div>
          <Brain :size="20" /><strong>Context / Task Memory</strong><span>{{ t("helpMemoryShort") }}</span>
        </div>
        <ArrowRight class="flow-arrow" :size="20" />
        <div>
          <FileText :size="20" /><strong>Report / Briefing</strong><span>{{ t("helpReportShort") }}</span>
        </div>
      </div>
    </section>

    <section class="help-section">
      <h3>{{ t("helpDataTitle") }}</h3>
      <dl class="data-roles">
        <div>
          <dt>Activity</dt>
          <dd>{{ t("helpActivityRole") }}</dd>
        </div>
        <div>
          <dt>Context</dt>
          <dd>{{ t("helpContextRole") }}</dd>
        </div>
        <div>
          <dt>Task Memory</dt>
          <dd>{{ t("helpMemoryRole") }}</dd>
        </div>
        <div>
          <dt>Report</dt>
          <dd>{{ t("helpReportRole") }}</dd>
        </div>
        <div>
          <dt>Global Memory</dt>
          <dd>{{ t("helpGlobalRole") }}</dd>
        </div>
        <div>
          <dt>Knowledge Graph</dt>
          <dd>{{ t("helpKnowledgeRole") }}</dd>
        </div>
        <div>
          <dt>People</dt>
          <dd>{{ t("helpPeopleRole") }}</dd>
        </div>
      </dl>
    </section>

    <section class="help-section">
      <h3>{{ t("helpWorkflowTitle") }}</h3>
      <ol class="workflow">
        <li>
          <span>1</span>
          <div>
            <h4>{{ t("helpStepUnderstandTitle") }}</h4>
            <p>{{ t("helpStepUnderstandBody") }}</p>
            <code>system_get_usage_guide · system_search_context</code>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <h4>{{ t("helpStepRecordTitle") }}</h4>
            <p>{{ t("helpStepRecordBody") }}</p>
            <code>activity_append_entry</code>
          </div>
        </li>
        <li>
          <span>3</span>
          <div>
            <h4>{{ t("helpStepFinishTitle") }}</h4>
            <p>{{ t("helpStepFinishBody") }}</p>
            <code>session_finish_task</code>
          </div>
        </li>
        <li>
          <span>4</span>
          <div>
            <h4>{{ t("helpStepPromoteTitle") }}</h4>
            <p>{{ t("helpStepPromoteBody") }}</p>
            <code>task_memory_promote_activity</code>
          </div>
        </li>
        <li>
          <span>5</span>
          <div>
            <h4>{{ t("helpStepOutputTitle") }}</h4>
            <p>{{ t("helpStepOutputBody") }}</p>
            <code>briefing_generate_daily · report_generate_output</code>
          </div>
        </li>
      </ol>
    </section>

    <section class="help-section two-column">
      <div>
        <h3>{{ t("helpWebTitle") }}</h3>
        <p>{{ t("helpWebBody") }}</p>
        <ul>
          <li>{{ t("helpWebSummary") }}</li>
          <li>{{ t("helpWebTask") }}</li>
          <li>{{ t("helpWebReport") }}</li>
          <li>{{ t("helpWebKnowledge") }}</li>
          <li>{{ t("helpWebSettings") }}</li>
        </ul>
      </div>
      <div>
        <h3>{{ t("helpSafetyTitle") }}</h3>
        <ul>
          <li>{{ t("helpSafetyActivity") }}</li>
          <li>{{ t("helpSafetyMemory") }}</li>
          <li>{{ t("helpSafetyDelete") }}</li>
          <li>{{ t("helpSafetySharing") }}</li>
        </ul>
      </div>
    </section>

    <section class="help-section quick-start">
      <ListChecks :size="24" />
      <div>
        <h3>{{ t("helpQuickTitle") }}</h3>
        <p>{{ t("helpQuickBody") }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.help-page {
  max-width: 1040px;
  margin: 0 auto;
}
.help-section {
  padding: 28px 0;
  border-bottom: 1px solid var(--line);
}
.help-section h3 {
  margin-bottom: 16px;
  font-size: 18px;
}
.section-lead,
.help-section p,
.help-section li,
.data-roles dd {
  color: var(--muted);
  line-height: 1.7;
}
.principles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
}
.principles article {
  display: flex;
  gap: 12px;
}
.principles svg {
  flex: 0 0 auto;
  color: var(--accent);
}
.principles h4,
.workflow h4 {
  margin: 0 0 6px;
  font-size: 15px;
}
.principles p,
.workflow p {
  margin: 0;
}
.data-flow {
  display: grid;
  align-items: center;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 12px;
  margin-top: 20px;
}
.data-flow > div {
  display: grid;
  min-height: 116px;
  align-content: center;
  gap: 7px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
}
.data-flow svg,
.quick-start > svg {
  color: var(--accent);
}
.data-flow span {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}
.flow-arrow {
  color: var(--muted);
}
.data-roles {
  margin: 0;
}
.data-roles > div {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  gap: 20px;
  padding: 14px 0;
  border-top: 1px solid var(--line);
}
.data-roles dt {
  font-weight: 700;
}
.data-roles dd {
  margin: 0;
}
.workflow {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
.workflow li {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 14px;
  padding: 16px 0;
  border-top: 1px solid var(--line);
}
.workflow li > span {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: var(--radius-control);
  color: var(--color-on-accent);
  background: var(--accent);
  font-weight: 700;
}
.workflow code {
  display: inline-block;
  max-width: 100%;
  margin-top: 8px;
  color: var(--text);
  overflow-wrap: anywhere;
}
.two-column {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 44px;
}
.two-column ul {
  margin-bottom: 0;
  padding-left: 20px;
}
.quick-start {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  border-bottom: 0;
}
.quick-start h3,
.quick-start p {
  margin-bottom: 0;
}
@media (max-width: 760px) {
  .principles,
  .two-column {
    grid-template-columns: 1fr;
  }
  .data-flow {
    grid-template-columns: 1fr;
  }
  .flow-arrow {
    margin: 0 auto;
    transform: rotate(90deg);
  }
  .data-roles > div {
    grid-template-columns: 1fr;
    gap: 5px;
  }
}
</style>
