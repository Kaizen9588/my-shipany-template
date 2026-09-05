import Empty from "@/components/blocks/empty";
import TableSlot from "@/components/console/slots/table";
import { Table as TableSlotType } from "@/types/slots/table";
import { getCreditsByUserUuid } from "@/models/credit";
import { getTranslations } from "next-intl/server";
import { getUserCredits } from "@/services/credit";
import { getUserUuid } from "@/services/user";
import { getLandingPage } from "@/services/page";
import { getLocale } from "next-intl/server";
import moment from "moment";
import RechargeButton from "./recharge-button";

/**
 * 我的积分（6.x）
 * 充值不再跳转主页：页内弹框展示与主页完全同源的定价卡片
 * （同一 <Pricing> 组件 + 同一份 landing JSON pricing 数据）。
 */
export default async function () {
  const t = await getTranslations();

  const user_uuid = await getUserUuid();

  if (!user_uuid) {
    return <Empty message="no auth" />;
  }

  const data = await getCreditsByUserUuid(user_uuid, 1, 100);

  const userCredits = await getUserCredits(user_uuid);

  // 与主页同源的定价数据（i18n/pages/landing/{locale}.json 的 pricing 段）
  const locale = await getLocale();
  const landing = await getLandingPage(locale);
  const pricing = landing.pricing;

  const table: TableSlotType = {
    title: t("my_credits.title"),
    tip: {
      title: t("my_credits.left_tip", {
        left_credits: userCredits?.left_credits || 0,
      }),
    },
    columns: [
      {
        title: t("my_credits.table.trans_no"),
        name: "trans_no",
      },
      {
        title: t("my_credits.table.trans_type"),
        name: "trans_type",
      },
      {
        title: t("my_credits.table.credits"),
        name: "credits",
      },
      {
        title: t("my_credits.table.updated_at"),
        name: "created_at",
        callback: (v: any) => {
          return moment(v.created_at).format("YYYY-MM-DD HH:mm:ss");
        },
      },
    ],
    data,
    empty_message: t("my_credits.no_credits"),
  };

  return (
    <div className="space-y-6">
      {/* 充值按钮行：与下方表格同一页面，点击弹框充值不跳转 */}
      {pricing && (
        <div className="flex justify-end">
          <RechargeButton
            pricing={pricing}
            label={t("my_credits.recharge")}
          />
        </div>
      )}
      <TableSlot {...table} />
    </div>
  );
}
