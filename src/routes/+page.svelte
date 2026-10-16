<script lang="ts">
  // Bundled editor faces (the CSP allows fonts from 'self' only). Each file declares per-script
  // unicode ranges, so only the subsets a document actually uses are loaded.
  import '@fontsource/ibm-plex-mono/400.css';
  import '@fontsource/ibm-plex-mono/400-italic.css';
  import '@fontsource/ibm-plex-mono/600.css';
  import '@fontsource/ibm-plex-sans-hebrew/400.css';
  import '@fontsource/ibm-plex-sans-hebrew/600.css';
  import '$lib/app.css';
  import App from '$lib/components/App.svelte';
</script>

<App />
