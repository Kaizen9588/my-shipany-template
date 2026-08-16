import GoogleAnalytics from "./google-analytics";
import OpenPanelAnalytics from "./open-panel";
import PostHogAnalytics from "./posthog";

export default function Analytics() {
  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  return (
    <>
      <PostHogAnalytics />
      <OpenPanelAnalytics />

      <GoogleAnalytics />
    </>
  );
}
