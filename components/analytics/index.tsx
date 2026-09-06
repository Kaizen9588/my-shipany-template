import GoogleAnalytics from "./google-analytics";
import PostHogAnalytics from "./posthog";

export default function Analytics() {
  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  return (
    <>
      <PostHogAnalytics />
      <GoogleAnalytics />
    </>
  );
}
