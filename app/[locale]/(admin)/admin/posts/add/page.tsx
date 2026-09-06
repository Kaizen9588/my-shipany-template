import { PostStatus, postStatusNames, findPostBySlug, insertPost } from "@/models/post";
import { localeNames, locales } from "@/i18n/locale";

import Empty from "@/components/blocks/empty";
import FormSlot from "@/components/dashboard/slots/form";
import { Form as FormSlotType } from "@/types/slots/form";
import { Post } from "@/types/post";
import { getIsoTimestr } from "@/lib/time";
import { getUserInfo } from "@/services/user";
import { getUuid } from "@/lib/hash";

export default async function () {
  const user = await getUserInfo();
  if (!user || !user.uuid) {
    return <Empty message="no auth" />;
  }

  const form: FormSlotType = {
    title: "新增文章",
    crumb: {
      items: [
        {
          title: "文章管理",
          url: "/admin/posts",
        },
        {
          title: "新增文章",
          is_active: true,
        },
      ],
    },
    fields: [
      {
        name: "title",
        title: "标题",
        type: "text",
        placeholder: "文章标题",
        validation: {
          required: true,
          message: "请输入标题",
        },
      },
      {
        name: "slug",
        title: "URL 路径（Slug）",
        type: "text",
        placeholder: "what-is-shipany",
        validation: {
          required: true,
          message: "请输入 URL 路径",
        },
        tip: "路径需唯一，前台访问地址形如 /blog/what-is-shipany",
      },
      {
        name: "locale",
        title: "发布语言",
        type: "select",
        options: locales.map((locale: string) => ({
          title: localeNames[locale],
          value: locale,
        })),
        value: "en",
        validation: {
          required: true,
        },
      },
      {
        name: "status",
        title: "状态",
        type: "select",
        options: Object.values(PostStatus).map((status: string) => ({
          title: postStatusNames[status] ?? status,
          value: status,
        })),
        value: PostStatus.Created,
      },
      {
        name: "description",
        title: "描述",
        type: "textarea",
        placeholder: "文章描述，用于 SEO 和列表展示",
      },
      {
        name: "cover_url",
        title: "封面图片 URL",
        type: "url",
        placeholder: "封面图片地址",
      },
      {
        name: "author_name",
        title: "作者名称",
        type: "text",
        placeholder: "作者名称",
      },
      {
        name: "author_avatar_url",
        title: "作者头像 URL",
        type: "url",
        placeholder: "作者头像图片地址",
      },
      {
        name: "content",
        title: "正文内容（Markdown）",
        type: "markdown_editor",
        placeholder: "用 Markdown 撰写文章正文",
      },
    ],
    submit: {
      button: {
        title: "提交",
      },
      handler: async (data: FormData, passby: any) => {
        "use server";

        const title = data.get("title") as string;
        const slug = data.get("slug") as string;
        const locale = data.get("locale") as string;
        const status = data.get("status") as string;
        const description = data.get("description") as string;
        const cover_url = data.get("cover_url") as string;
        const author_name = data.get("author_name") as string;
        const author_avatar_url = data.get("author_avatar_url") as string;
        const content = data.get("content") as string;

        if (
          !title ||
          !title.trim() ||
          !slug ||
          !slug.trim() ||
          !locale ||
          !locale.trim()
        ) {
          throw new Error("表单数据不完整，请检查标题、路径和语言");
        }

        const existPost = await findPostBySlug(slug, locale);
        if (existPost) {
          throw new Error("相同路径的文章已存在，请换一个 URL 路径");
        }

        const post: Post = {
          uuid: getUuid(),
          created_at: getIsoTimestr(),
          status: status as PostStatus,
          title,
          slug,
          locale,
          description,
          cover_url,
          author_name,
          author_avatar_url,
          content,
        };

        try {
          await insertPost(post);

          return {
            status: "success",
            message: "文章已创建",
            redirect_url: "/admin/posts",
          };
        } catch (err: any) {
          throw new Error(err.message);
        }
      },
    },
  };

  return <FormSlot {...form} />;
}
