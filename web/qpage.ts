import { IPageMeta, ISection, IQPageConfig } from "qpage"

export const config: IQPageConfig = {
    dist: import.meta.dirname + "/../docs",
    defaultLang: "zh-Hans",
}

import UrlIcon from "./icons/Q_____c.png"
import UrlIconFull from "./icons/Q_____c-full-256.png"

import UrlMainScreenshotImage from "./assets/s1.png"

export const page: IPageMeta = {
    productTitle: "Q_____c",
    productTitleCN: "科学马赛克",
    tagline: "科学的隐私打码解决方案，可逆马赛克，跨平台，免费，开源",
    taglineShort: "可逆隐私打码",
    icon: UrlIcon,
    iconFull: UrlIconFull,
    metaDesc:
        "科学的隐私打码解决方案，可逆马赛克，跨平台，免费，开源，Q_____c，Q_c，骑马赛克，可逆马赛克，隐私打码",
    githubRepo: "https://github.com/qzrzz/Q_____c",
    onlineUrl: "https://qzrzz.com/Q_____c",
    webAppUrl: "https://qzrzz.github.io/Q_____c/",
    platforms: ["web"],
    mainScreenshotImage: UrlMainScreenshotImage,
}

export const sections: ISection[] = [
    {
        id: "intro",
        title: "隐私很重要，图片打码需可逆恢复",
        description:
            "存储图片数据时，常常会对隐私部分进行马赛克进行遮挡，但有时我们希望马赛克只是暂时的，可以在必要时恢复",
        cards: [{ image: "./assets/s2.png", style: "center" }],
    },

    {
        id: "restore",
        title: "鲁棒性， 图片发布到社交网站、聊天软件中、再次保存也能恢复",
        description:
            "使用离散傅里叶变换，将隐私区域转化为频域图像，即使图片被再次保存，缩放、压缩也能恢复。支持 JPEG 再次编码。",
        cards: [
            {
                image: "./assets/s3.png",
                style: "center",

                imageDesc:
                    "但为了保证效果，建议不要大幅二次缩放，如果要发布到社交网站，由于社交网站限制最大图片尺寸，如果图片尺寸过大，建议先缩放到社交网站推荐尺寸之内，再打码，避免被缩放",
            },
        ],
    },

    {
        id: "password",
        title: "隐私性，可选密码加密",
        description: "可以为打码添加密码，只有提供密码才能恢复，防止隐私泄露",
        cards: [{ image: "./assets/s4.png", style: "center" }],
    },

    {
        id: "extension",
        title: "便捷性，浏览器插件",
        description: "可以通过浏览器插件方便的把网页中的 Q_____c 马赛克图片恢复为原图",
        cards: [
            {
                style: "left",
                imageDesc: `<a href="https://github.com/qzrzz/Q_____c/releases"> → 浏览器插件</a>`,
            },
        ],
    },
]
