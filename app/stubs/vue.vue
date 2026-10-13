<!-- Placeholder while __ID__ · __NAME__ is being built. Replace this whole file. -->
<script setup lang="ts">
const steps = [
  { label: 'Planning the look', active: true },
  { label: 'Writing the first screen', active: false },
  { label: 'Content and interactions', active: false },
  { label: 'Checks and screenshots', active: false },
]
</script>

<template>
  <div dir="ltr" class="grid min-h-full place-items-center bg-zinc-50 p-6 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
    <div class="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900" role="status" aria-live="polite">
      <div class="flex items-center gap-3">
        <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-zinc-900 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">__ID__</span>
        <div class="min-w-0">
          <p class="text-xs text-zinc-500 dark:text-zinc-400">Building</p>
          <h1 class="truncate text-lg leading-tight font-semibold tracking-tight">__NAME__</h1>
        </div>
      </div>
      <ol class="mt-5 space-y-3 border-t border-zinc-100 pt-5 dark:border-zinc-800">
        <li v-for="s in steps" :key="s.label" class="flex items-center gap-3 text-sm">
          <span v-if="s.active" aria-hidden="true" class="size-4 rounded-full border-2 border-zinc-200 border-t-zinc-900 motion-safe:animate-spin dark:border-zinc-700 dark:border-t-zinc-100" />
          <span v-else aria-hidden="true" class="size-4 rounded-full border-2 border-zinc-200 dark:border-zinc-700" />
          <span :class="s.active ? 'font-medium' : 'text-zinc-400 dark:text-zinc-500'">{{ s.label }}</span>
        </li>
      </ol>
    </div>
  </div>
</template>
