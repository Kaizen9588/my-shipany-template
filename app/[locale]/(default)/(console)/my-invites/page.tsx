import { RiDiscordFill, RiEmotionSadFill, RiGithubFill } from "react-icons/ri";
import { getAffiliateSummary, getUserAffiliates } from "@/models/affiliate";
import { getAffiliateRewardCredits } from "@/models/credit";
import { getOrdersByPaidEmail, getOrdersByUserUuid } from "@/models/order";
import { getUserEmail, getUserUuid } from "@/services/user";

import Invite from "@/components/invite";
import Link from "next/link";
import TableBlock from "@/components/blocks/table";
import { TableColumn } from "@/types/blocks/table";
import { Table as TableSlotType } from "@/types/slots/table";
import { findUserByUuid } from "@/models/user";
import { getLocale, getTranslations } from "next-intl/server";
import moment from "moment";
import { redirect } from "@/i18n/navigation";

export default async function () {
  const t = await getTranslations();

  const user_uuid = await getUserUuid();
  const user_email = await getUserEmail();

  const callbackUrl = "/my-invites";
  const locale = await getLocale();
  if (!user_uuid) {
    redirect({
      href: `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`,
      locale,
    });
  }

  const user = await findUserByUuid(user_uuid);
  if (!user) {
    redirect({
      href: `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`,
      locale,
    });
  }

  let orders = await getOrdersByUserUuid(user_uuid);
  if (!orders || orders.length === 0) {
    orders = await getOrdersByPaidEmail(user_email);
  }

  user.is_affiliate = true;

  if (!orders || orders.length === 0) {
    // not bought
    if (!user.is_affiliate) {
      // no right
      return (
        <div className="text-center flex flex-col items-center justify-center h-full py-16 gap-4">
          <RiEmotionSadFill className="w-8 h-8" />
          <span>{t("my_invites.no_orders")}</span>
        </div>
      );
    }
  } else {
    // bought
    let is_affiliate = false;
    for (const order of orders) {
      if (order.product_id === "premium") {
        is_affiliate = true;
        break;
      }
    }

    if (!is_affiliate && !user.is_affiliate) {
      return (
        <div className="text-center flex flex-col items-center justify-center h-full py-16 gap-4">
          <RiEmotionSadFill className="w-8 h-8" />
          <span>{t("my_invites.no_affiliates")}</span>
          <Link
            href="https://discord.gg/HQNnrzjZQS"
            target="_blank"
            className="flex items-center gap-1 font-semibold text-sm text-primary border border-primary rounded-md px-4 py-2"
          >
            <RiDiscordFill className="text-xl" />
            Discord
          </Link>
        </div>
      );
    }
  }

  const affiliates = await getUserAffiliates(user_uuid);

  const summary = await getAffiliateSummary(user_uuid);
  const reward_credits = await getAffiliateRewardCredits(user_uuid);

  const columns: TableColumn[] = [
    {
      name: "created_at",
      title: t("my_invites.table.invite_time"),
      callback: (item) => moment(item.created_at).format("YYYY-MM-DD HH:mm:ss"),
    },
    {
      name: "user",
      title: t("my_invites.table.invite_user"),
      callback: (item) => (
        <div className="flex items-center gap-2">
          {item?.user?.avatar_url && (
            <img
              src={item.user?.avatar_url || ""}
              className="w-8 h-8 rounded-full"
            />
          )}
          <span>{item.user?.nickname}</span>
        </div>
      ),
    },
    {
      name: "status",
      title: t("my_invites.table.status"),
      callback: (item) =>
        item.status === "pending"
          ? t("my_invites.table.pending")
          : item.status === "reversed"
            ? t("my_invites.table.reversed")
            : t("my_invites.table.completed"),
    },
    {
      name: "reward_amount",
      title: t("my_invites.table.reward_amount"),
      callback: (item) => `$${item.reward_amount / 100}`,
    },
  ];

  const table: TableSlotType = {
    title: t("my_invites.title"),
    description: t("my_invites.description"),
    tip: {
      description: t("my_invites.my_invite_link"),
    },
    toolbar: {
      items: [
        {
          title: t("my_invites.edit_invite_link"),
          icon: "RiBookLine",
          url: "https://docs.shipany.ai",
          target: "_blank",
          variant: "outline",
        },
        {
          title: t("my_invites.copy_invite_link"),
          icon: "RiCopy2Line",
          url: "https://discord.gg/HQNnrzjZQS",
          target: "_blank",
        },
      ],
    },
    columns: columns,
    data: affiliates,
    empty_message: t("my_invites.no_invites"),
  };

  return (
    <div className="space-y-8">
      <Invite summary={summary} reward_credits={reward_credits} />
      <TableBlock {...table} />
    </div>
  );
}
