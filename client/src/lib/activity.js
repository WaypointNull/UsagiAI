import { reactive } from 'vue';

export const activity = reactive({
  key: null,
  label: '',
  progress: null
});

export function setActivity(key, label, progress = null) {
  activity.key = key;
  activity.label = label;
  activity.progress = progress;
}

export function clearActivity(key) {
  if (activity.key === key) {
    activity.key = null;
    activity.label = '';
    activity.progress = null;
  }
}
