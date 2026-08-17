import Dropdown from "@/components/blocks/table/dropdown";
import { NavItem } from "@/types/blocks/base";
import { Post } from "@/types/post";
import TableSlot from "@/components/dashboard/slots/table";
import { Table as TableSlotType } from "@/types/slots/table";
import { getAllPosts } from "@/models/post";
import moment from "moment";

export default async function () {
  const posts = await getAllPosts();

  const table: TableSlotType = {
    title: "文章管理",
    toolbar: {
      items: [
        {
          title: "新增文章",
          icon: "RiAddLine",
          url: "/admin/posts/add",
        },
      ],
    },
    columns: [
      {
        name: "title",
        title: "标题",
      },
      {
        name: "description",
        title: "描述",
      },
      {
        name: "slug",
        title: "路径",
      },
      {
        name: "locale",
        title: "语言",
      },
      {
        name: "status",
        title: "状态",
      },
      {
        name: "created_at",
        title: "创建时间",
        callback: (item: Post) => {
          return moment(item.created_at).format("YYYY-MM-DD HH:mm:ss");
        },
      },
      {
        callback: (item: Post) => {
          const items: NavItem[] = [
            {
              title: "编辑",
              icon: "RiEditLine",
              url: `/admin/posts/${item.uuid}/edit`,
            },
            {
              title: "查看",
              icon: "RiEyeLine",
              url: `/${item.locale}/posts/${item.slug}`,
              target: "_blank",
            },
          ];

          return <Dropdown items={items} />;
        },
      },
    ],
    data: posts,
    empty_message: "No posts found",
  };

  return <TableSlot {...table} />;
}
