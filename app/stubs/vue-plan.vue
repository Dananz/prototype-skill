<!-- Placeholder while __ID__ · __NAME__ is being built: its one-line plan. Replace this whole file. -->
<script setup lang="ts">
import { font } from '../../fonts'

const plan = __PLAN__
const family = (name: string | null) => name ? `'${name}'` : undefined
font(plan.display, plan.body)
</script>

<template>
  <div :dir="plan.dir" class="@container flex min-h-full flex-col p-[6cqi]" :style="{ background: plan.surface, color: plan.ink }">
    <div class="flex items-center gap-2 text-[clamp(.75rem,1.4cqi,1rem)] opacity-60" :style="{ fontFamily: family(plan.bodyFamily) }">
      <span class="size-2 animate-pulse rounded-full" :style="{ background: plan.accent }" />
      <span>Building __ID__ · __NAME__</span>
    </div>
    <h1 class="mt-[8cqi] text-[15cqi] leading-[0.95]" :style="{ fontFamily: family(plan.displayFamily) }">{{ plan.name }}</h1>
    <p v-if="plan.concept" class="mt-6 max-w-[40ch] text-[clamp(1rem,2.6cqi,2rem)] opacity-80" :style="{ fontFamily: family(plan.bodyFamily) }">{{ plan.concept }}</p>
    <p v-if="plan.signature" class="mt-3 max-w-[40ch] text-[clamp(.875rem,1.8cqi,1.25rem)] opacity-60" :style="{ fontFamily: family(plan.bodyFamily) }">{{ plan.signature }}</p>
    <div class="mt-auto flex gap-2 pt-[6cqi]">
      <span v-for="c in [plan.surface, plan.ink, plan.accent].filter(Boolean)" :key="c" class="size-6 rounded-full ring-1 ring-current/20" :style="{ background: c }" />
    </div>
  </div>
</template>
