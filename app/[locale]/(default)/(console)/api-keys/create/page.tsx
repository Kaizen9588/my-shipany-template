import Empty from "@/components/blocks/empty";
import { getTranslations } from "next-intl/server";
import { getUserUuid } from "@/services/user";
import CreateApiKeyForm from "./create-form";

export default async function () {
  const t = await getTranslations();

  const user_uuid = await getUserUuid();
  if (!user_uuid) {
    return <Empty message="no auth" />;
  }

  return <CreateApiKeyForm />;
}
