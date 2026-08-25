import type { II18nConfig } from "qpage"

const i18n: II18nConfig = {
    defaultLang: "zh-Hans",
    langs: {
        "zh-Hans": {
            name: "简体中文",
        },
        en: {
            name: "English",
            page: {
                tagline: "A scientific privacy-mosaicing solution: reversible mosaics, cross-platform, free, and open source",
                taglineShort: "Reversible privacy mosaics",
                metaDesc:
                    "A scientific privacy-mosaicing solution with reversible mosaics. Cross-platform, free, and open source. Q_____c and Q_c for reversible privacy protection.",
            },
            sections: [
                {
                    id: "intro",
                    title: "Privacy matters. Image mosaics should be reversible.",
                    description:
                        "When storing image data, private areas are often covered with mosaics. But sometimes we want the mosaic to be temporary and recoverable when needed.",
                },
                {
                    id: "restore",
                    title: "Robustness: restore images after posting to social networks, sending them through chat apps, or saving them again",
                    description:
                        "Using the discrete Fourier transform, private areas are converted into frequency-domain images. They can still be restored even after an image is saved again, resized, or compressed. JPEG re-encoding is supported.",
                    cards: [
                        {
                            imageDesc:
                                "To ensure the best results, avoid significant secondary resizing. If posting to social networks, which limit maximum image dimensions, resize oversized images to the platform's recommended dimensions before applying the mosaic to prevent further resizing.",
                        },
                    ],
                },
                {
                    id: "password",
                    title: "Privacy: optional password encryption",
                    description:
                        "Add a password to the mosaic. Only those with the password can restore the original image, helping prevent privacy leaks.",
                },
                {
                    id: "extension",
                    title: "Convenience: browser extension",
                    description:
                        "Use the browser extension to conveniently restore Q_____c-mosaiced images on web pages to their originals.",
                    cards: [
                        {
                            imageDesc: '<a href="https://github.com/qzrzz/Q_____c/releases"> → Browser extension</a>',
                        },
                    ],
                },
            ],
            ui: {
                download: "Download",
                useNow: "Use Now",
                viewOnGithub: "GitHub",
                selectPlatform: "Choose platform",
                thisDevice: "This device",
                langSwitchAria: "Select language",
                otherProducts: "Other products",
                moreProducts: "More products",
                productLinks: "Product",
                contact: "Contact",
                officialWebsite: "Website",
                docs: "Documentation",
                changelog: "Changelog",
            },
        },
        ja: {
            name: "日本語",
            page: {
                tagline: "科学に基づくプライバシー保護モザイクソリューション。可逆モザイク、クロスプラットフォーム、無料・オープンソース",
                taglineShort: "可逆プライバシーモザイク",
                metaDesc:
                    "科学に基づくプライバシー保護モザイクソリューション。可逆モザイク、クロスプラットフォーム、無料・オープンソースの Q_____c。",
            },
            sections: [
                {
                    id: "intro",
                    title: "プライバシーは大切。画像のモザイクは元に戻せるべきです",
                    description:
                        "画像データを保存する際、プライバシーに関わる部分をモザイクで隠すことがよくあります。しかし、必要なときに復元できる一時的なモザイクにしたい場合もあります。",
                },
                {
                    id: "restore",
                    title: "堅牢性：SNSやチャットアプリで共有したり、再保存した画像も復元",
                    description:
                        "離散フーリエ変換を用いて、プライバシー領域を周波数領域の画像に変換します。画像を再保存したり、拡大・縮小、圧縮したりしても復元できます。JPEGの再エンコードにも対応しています。",
                    cards: [
                        {
                            imageDesc:
                                "確実に復元するため、大幅な再縮小は避けることをおすすめします。SNSに投稿する場合、SNSには画像サイズの上限があるため、画像が大きすぎるときは、縮小されるのを防ぐため、先にSNSが推奨するサイズ内に縮小してからモザイクをかけてください。",
                        },
                    ],
                },
                {
                    id: "password",
                    title: "プライバシー保護：パスワード暗号化に対応",
                    description:
                        "モザイクにパスワードを設定できます。パスワードを知っている人だけが復元できるため、プライバシーの漏えいを防げます。",
                },
                {
                    id: "extension",
                    title: "手軽さ：ブラウザ拡張機能",
                    description:
                        "ブラウザ拡張機能を使えば、ウェブページ上の Q_____c モザイク画像を元の画像に簡単に復元できます。",
                    cards: [
                        {
                            imageDesc: '<a href="https://github.com/qzrzz/Q_____c/releases"> → ブラウザ拡張機能</a>',
                        },
                    ],
                },
            ],
            ui: {
                download: "ダウンロード",
                useNow: "今すぐ使う",
                viewOnGithub: "GitHub",
                selectPlatform: "プラットフォームを選択",
                thisDevice: "このデバイス",
                langSwitchAria: "言語を選択",
                otherProducts: "その他の製品",
                moreProducts: "その他の製品",
                productLinks: "製品",
                contact: "連絡先",
                officialWebsite: "公式サイト",
                docs: "ドキュメント",
                changelog: "変更履歴",
            },
        },
        ko: {
            name: "한국어",
            page: {
                tagline: "과학적인 개인정보 보호 모자이크 솔루션: 복원 가능한 모자이크, 크로스 플랫폼, 무료 및 오픈 소스",
                taglineShort: "복원 가능한 개인정보 보호 모자이크",
                metaDesc:
                    "과학적인 개인정보 보호 모자이크 솔루션. 복원 가능한 모자이크를 지원하며 크로스 플랫폼, 무료, 오픈 소스인 Q_____c입니다.",
            },
            sections: [
                {
                    id: "intro",
                    title: "개인정보는 중요합니다. 이미지 모자이크는 복원 가능해야 합니다.",
                    description:
                        "이미지 데이터를 저장할 때 개인정보가 포함된 영역을 모자이크로 가리는 경우가 많습니다. 하지만 필요할 때 복원할 수 있도록 모자이크를 일시적으로 적용하고 싶은 경우도 있습니다.",
                },
                {
                    id: "restore",
                    title: "강력한 복원력: 소셜 네트워크·채팅 앱에 공유하거나 다시 저장한 이미지도 복원",
                    description:
                        "이산 푸리에 변환을 사용해 개인정보 영역을 주파수 영역 이미지로 변환합니다. 이미지를 다시 저장하거나 크기를 조정하고 압축해도 복원할 수 있습니다. JPEG 재인코딩도 지원합니다.",
                    cards: [
                        {
                            imageDesc:
                                "최상의 결과를 보장하려면 크게 다시 크기를 조정하지 않는 것이 좋습니다. 소셜 네트워크에 게시할 때는 서비스마다 최대 이미지 크기 제한이 있으므로, 이미지가 너무 크다면 서비스 권장 크기 안으로 먼저 줄인 다음 모자이크를 적용하세요. 그래야 업로드 과정에서 이미지가 다시 조정되는 것을 피할 수 있습니다.",
                        },
                    ],
                },
                {
                    id: "password",
                    title: "개인정보 보호: 선택적 비밀번호 암호화",
                    description:
                        "모자이크에 비밀번호를 설정할 수 있습니다. 비밀번호를 아는 사람만 원본 이미지를 복원할 수 있어 개인정보 유출을 막을 수 있습니다.",
                },
                {
                    id: "extension",
                    title: "편리함: 브라우저 확장 프로그램",
                    description:
                        "브라우저 확장 프로그램을 사용하면 웹 페이지의 Q_____c 모자이크 이미지를 원본으로 편리하게 복원할 수 있습니다.",
                    cards: [
                        {
                            imageDesc: '<a href="https://github.com/qzrzz/Q_____c/releases"> → 브라우저 확장 프로그램</a>',
                        },
                    ],
                },
            ],
            ui: {
                download: "다운로드",
                useNow: "지금 사용하기",
                viewOnGithub: "GitHub",
                selectPlatform: "플랫폼 선택",
                thisDevice: "이 기기",
                langSwitchAria: "언어 선택",
                otherProducts: "다른 제품",
                moreProducts: "더 많은 제품",
                productLinks: "제품",
                contact: "연락처",
                officialWebsite: "공식 웹사이트",
                docs: "문서",
                changelog: "변경 기록",
            },
        },
        vi: {
            name: "Tiếng Việt",
            page: {
                tagline: "Giải pháp mosaic bảo vệ quyền riêng tư dựa trên khoa học: mosaic có thể khôi phục, đa nền tảng, miễn phí và mã nguồn mở",
                taglineShort: "Mosaic riêng tư có thể khôi phục",
                metaDesc:
                    "Giải pháp mosaic bảo vệ quyền riêng tư dựa trên khoa học, hỗ trợ mosaic có thể khôi phục, đa nền tảng, miễn phí và mã nguồn mở. Q_____c và Q_c.",
            },
            sections: [
                {
                    id: "intro",
                    title: "Quyền riêng tư rất quan trọng. Mosaic trên ảnh nên có thể khôi phục.",
                    description:
                        "Khi lưu trữ dữ liệu hình ảnh, các vùng riêng tư thường được che bằng mosaic. Tuy nhiên, đôi khi chúng ta muốn mosaic chỉ là tạm thời và có thể khôi phục khi cần.",
                },
                {
                    id: "restore",
                    title: "Độ bền: vẫn khôi phục được sau khi đăng lên mạng xã hội, gửi qua ứng dụng trò chuyện hoặc lưu lại",
                    description:
                        "Sử dụng biến đổi Fourier rời rạc để chuyển vùng riêng tư thành hình ảnh trong miền tần số. Ảnh vẫn có thể được khôi phục ngay cả khi được lưu lại, thay đổi kích thước hoặc nén. Hỗ trợ tái mã hóa JPEG.",
                    cards: [
                        {
                            imageDesc:
                                "Để đảm bảo kết quả tốt nhất, bạn nên tránh thay đổi kích thước lần hai quá nhiều. Khi đăng lên mạng xã hội, do các nền tảng này giới hạn kích thước ảnh tối đa, nếu ảnh quá lớn, hãy giảm ảnh về kích thước được nền tảng khuyến nghị trước khi áp dụng mosaic để tránh ảnh bị thay đổi kích thước lần nữa.",
                        },
                    ],
                },
                {
                    id: "password",
                    title: "Tính riêng tư: mã hóa bằng mật khẩu tùy chọn",
                    description:
                        "Bạn có thể thêm mật khẩu cho mosaic. Chỉ người có mật khẩu mới khôi phục được ảnh gốc, giúp ngăn ngừa rò rỉ quyền riêng tư.",
                },
                {
                    id: "extension",
                    title: "Tiện lợi: tiện ích mở rộng trình duyệt",
                    description:
                        "Tiện ích mở rộng trình duyệt giúp bạn dễ dàng khôi phục ảnh mosaic Q_____c trên các trang web về ảnh gốc.",
                    cards: [
                        {
                            imageDesc: '<a href="https://github.com/qzrzz/Q_____c/releases"> → Tiện ích mở rộng trình duyệt</a>',
                        },
                    ],
                },
            ],
            ui: {
                download: "Tải xuống",
                useNow: "Dùng ngay",
                viewOnGithub: "GitHub",
                selectPlatform: "Chọn nền tảng",
                thisDevice: "Thiết bị này",
                langSwitchAria: "Chọn ngôn ngữ",
                otherProducts: "Sản phẩm khác",
                moreProducts: "Thêm sản phẩm",
                productLinks: "Sản phẩm",
                contact: "Liên hệ",
                officialWebsite: "Trang web chính thức",
                docs: "Tài liệu",
                changelog: "Nhật ký thay đổi",
            },
        },
        pt: {
            name: "Português",
            page: {
                tagline: "Uma solução científica de mosaico para privacidade: mosaicos reversíveis, multiplataforma, gratuita e de código aberto",
                taglineShort: "Mosaico de privacidade reversível",
                metaDesc:
                    "Uma solução científica de mosaico para privacidade, com mosaicos reversíveis, multiplataforma, gratuita e de código aberto. Q_____c e Q_c.",
            },
            sections: [
                {
                    id: "intro",
                    title: "Privacidade é importante. O mosaico das imagens deve ser reversível.",
                    description:
                        "Ao armazenar dados de imagem, áreas privadas costumam ser cobertas com mosaico. Mas, às vezes, queremos que o mosaico seja apenas temporário e possa ser removido quando necessário.",
                },
                {
                    id: "restore",
                    title: "Robustez: restaure imagens depois de publicá-las em redes sociais, enviá-las por apps de conversa ou salvá-las novamente",
                    description:
                        "Usando a transformada discreta de Fourier, as áreas privadas são convertidas em imagens no domínio da frequência. Elas continuam podendo ser restauradas mesmo após a imagem ser salva novamente, redimensionada ou comprimida. Compatível com recodificação JPEG.",
                    cards: [
                        {
                            imageDesc:
                                "Para garantir os melhores resultados, recomendamos evitar redimensionamentos significativos posteriores. Ao publicar em redes sociais, que limitam as dimensões máximas das imagens, redimensione primeiro imagens grandes para dentro do tamanho recomendado pela plataforma e só então aplique o mosaico, evitando que sejam redimensionadas novamente.",
                        },
                    ],
                },
                {
                    id: "password",
                    title: "Privacidade: criptografia opcional por senha",
                    description:
                        "Adicione uma senha ao mosaico. Somente quem tiver a senha poderá restaurar a imagem original, ajudando a evitar vazamentos de privacidade.",
                },
                {
                    id: "extension",
                    title: "Praticidade: extensão para navegador",
                    description:
                        "Use a extensão para navegador para restaurar com facilidade as imagens com mosaico Q_____c em páginas da web para as imagens originais.",
                    cards: [
                        {
                            imageDesc: '<a href="https://github.com/qzrzz/Q_____c/releases"> → Extensão para navegador</a>',
                        },
                    ],
                },
            ],
            ui: {
                download: "Baixar",
                useNow: "Usar agora",
                viewOnGithub: "GitHub",
                selectPlatform: "Escolher plataforma",
                thisDevice: "Este dispositivo",
                langSwitchAria: "Selecionar idioma",
                otherProducts: "Outros produtos",
                moreProducts: "Mais produtos",
                productLinks: "Produto",
                contact: "Contato",
                officialWebsite: "Site oficial",
                docs: "Documentação",
                changelog: "Registro de alterações",
            },
        },
        es: {
            name: "Español",
            page: {
                tagline: "Una solución científica de mosaico para la privacidad: mosaicos reversibles, multiplataforma, gratuita y de código abierto",
                taglineShort: "Mosaico de privacidad reversible",
                metaDesc:
                    "Una solución científica de mosaico para la privacidad, con mosaicos reversibles, multiplataforma, gratuita y de código abierto. Q_____c y Q_c.",
            },
            sections: [
                {
                    id: "intro",
                    title: "La privacidad importa. Los mosaicos de las imágenes deberían ser reversibles.",
                    description:
                        "Al almacenar datos de imagen, las zonas privadas suelen cubrirse con un mosaico. Sin embargo, a veces queremos que el mosaico sea temporal y pueda recuperarse cuando sea necesario.",
                },
                {
                    id: "restore",
                    title: "Robustez: recupera imágenes después de publicarlas en redes sociales, enviarlas por aplicaciones de chat o guardarlas de nuevo",
                    description:
                        "Mediante la transformada discreta de Fourier, las zonas privadas se convierten en imágenes del dominio de la frecuencia. Pueden recuperarse incluso después de volver a guardar, redimensionar o comprimir la imagen. También se admite la recodificación JPEG.",
                    cards: [
                        {
                            imageDesc:
                                "Para garantizar los mejores resultados, evita redimensionar mucho la imagen por segunda vez. Si vas a publicarla en redes sociales, que limitan las dimensiones máximas, redimensiona primero las imágenes demasiado grandes al tamaño recomendado por la plataforma y aplica después el mosaico para evitar que vuelvan a redimensionarse.",
                        },
                    ],
                },
                {
                    id: "password",
                    title: "Privacidad: cifrado opcional con contraseña",
                    description:
                        "Puedes añadir una contraseña al mosaico. Solo quien tenga la contraseña podrá recuperar la imagen original, lo que ayuda a evitar filtraciones de privacidad.",
                },
                {
                    id: "extension",
                    title: "Comodidad: extensión del navegador",
                    description:
                        "La extensión del navegador permite recuperar cómodamente las imágenes con mosaico Q_____c de las páginas web y devolverlas a su estado original.",
                    cards: [
                        {
                            imageDesc: '<a href="https://github.com/qzrzz/Q_____c/releases"> → Extensión del navegador</a>',
                        },
                    ],
                },
            ],
            ui: {
                download: "Descargar",
                useNow: "Usar ahora",
                viewOnGithub: "GitHub",
                selectPlatform: "Elegir plataforma",
                thisDevice: "Este dispositivo",
                langSwitchAria: "Seleccionar idioma",
                otherProducts: "Otros productos",
                moreProducts: "Más productos",
                productLinks: "Producto",
                contact: "Contacto",
                officialWebsite: "Sitio web oficial",
                docs: "Documentación",
                changelog: "Registro de cambios",
            },
        },
        de: {
            name: "Deutsch",
            page: {
                tagline: "Eine wissenschaftlich fundierte Lösung für Datenschutz-Mosaike: reversibel, plattformübergreifend, kostenlos und quelloffen",
                taglineShort: "Reversibles Datenschutz-Mosaik",
                metaDesc:
                    "Eine wissenschaftlich fundierte Lösung für Datenschutz-Mosaike: reversibel, plattformübergreifend, kostenlos und quelloffen. Q_____c und Q_c.",
            },
            sections: [
                {
                    id: "intro",
                    title: "Privatsphäre ist wichtig. Bildmosaike sollten reversibel sein.",
                    description:
                        "Beim Speichern von Bilddaten werden private Bereiche oft mit einem Mosaik verdeckt. Manchmal soll dieses Mosaik jedoch nur vorübergehend sein und bei Bedarf entfernt werden können.",
                },
                {
                    id: "restore",
                    title: "Robustheit: Bilder bleiben wiederherstellbar, auch nach dem Teilen in sozialen Netzwerken, Chat-Apps oder erneutem Speichern",
                    description:
                        "Mithilfe der diskreten Fourier-Transformation werden private Bereiche in Bilder im Frequenzbereich umgewandelt. Die Bilder lassen sich auch nach erneutem Speichern, Skalieren oder Komprimieren wiederherstellen. Die erneute JPEG-Kodierung wird unterstützt.",
                    cards: [
                        {
                            imageDesc:
                                "Für optimale Ergebnisse sollten Sie eine starke nachträgliche Skalierung vermeiden. Wenn Sie Bilder in sozialen Netzwerken veröffentlichen, die maximale Bildgrößen vorgeben, skalieren Sie zu große Bilder zuerst auf die von der Plattform empfohlene Größe und wenden Sie anschließend das Mosaik an. So vermeiden Sie eine weitere Skalierung durch die Plattform.",
                        },
                    ],
                },
                {
                    id: "password",
                    title: "Privatsphäre: optionale Passwortverschlüsselung",
                    description:
                        "Sie können das Mosaik mit einem Passwort schützen. Nur wer das Passwort kennt, kann das Originalbild wiederherstellen, wodurch sich Datenschutzverletzungen vermeiden lassen.",
                },
                {
                    id: "extension",
                    title: "Komfort: Browser-Erweiterung",
                    description:
                        "Mit der Browser-Erweiterung können Sie Q_____c-Mosaikbilder auf Webseiten bequem wieder in ihre Originalbilder zurückverwandeln.",
                    cards: [
                        {
                            imageDesc: '<a href="https://github.com/qzrzz/Q_____c/releases"> → Browser-Erweiterung</a>',
                        },
                    ],
                },
            ],
            ui: {
                download: "Herunterladen",
                useNow: "Jetzt verwenden",
                viewOnGithub: "GitHub",
                selectPlatform: "Plattform auswählen",
                thisDevice: "Dieses Gerät",
                langSwitchAria: "Sprache auswählen",
                otherProducts: "Weitere Produkte",
                moreProducts: "Mehr Produkte",
                productLinks: "Produkt",
                contact: "Kontakt",
                officialWebsite: "Website",
                docs: "Dokumentation",
                changelog: "Änderungsprotokoll",
            },
        },
        fr: {
            name: "Français",
            page: {
                tagline: "Une solution scientifique de mosaïquage pour la confidentialité : mosaïques réversibles, multiplateforme, gratuite et open source",
                taglineShort: "Mosaïque de confidentialité réversible",
                metaDesc:
                    "Une solution scientifique de mosaïquage pour la confidentialité, avec des mosaïques réversibles, multiplateforme, gratuite et open source. Q_____c et Q_c.",
            },
            sections: [
                {
                    id: "intro",
                    title: "La confidentialité est importante. Les mosaïques d'images devraient être réversibles.",
                    description:
                        "Lorsqu'on stocke des données d'image, les zones privées sont souvent masquées par une mosaïque. Mais il est parfois préférable que cette mosaïque soit temporaire et puisse être supprimée au besoin.",
                },
                {
                    id: "restore",
                    title: "Robustesse : restaurez vos images après une publication sur les réseaux sociaux, un envoi dans une messagerie ou un nouvel enregistrement",
                    description:
                        "Grâce à la transformée de Fourier discrète, les zones privées sont converties en images dans le domaine fréquentiel. Elles restent récupérables même après un nouvel enregistrement, un redimensionnement ou une compression de l'image. Le réencodage JPEG est pris en charge.",
                    cards: [
                        {
                            imageDesc:
                                "Pour garantir les meilleurs résultats, évitez les redimensionnements secondaires importants. Pour publier sur les réseaux sociaux, qui limitent les dimensions maximales des images, redimensionnez d'abord les images trop grandes aux dimensions recommandées par la plateforme, puis appliquez la mosaïque afin d'éviter un nouveau redimensionnement.",
                        },
                    ],
                },
                {
                    id: "password",
                    title: "Confidentialité : chiffrement facultatif par mot de passe",
                    description:
                        "Ajoutez un mot de passe à la mosaïque. Seules les personnes qui le possèdent pourront restaurer l'image originale, ce qui aide à prévenir les fuites de confidentialité.",
                },
                {
                    id: "extension",
                    title: "Simplicité : extension de navigateur",
                    description:
                        "L'extension de navigateur vous permet de restaurer facilement les images avec mosaïque Q_____c présentes sur les pages web.",
                    cards: [
                        {
                            imageDesc: '<a href="https://github.com/qzrzz/Q_____c/releases"> → Extension de navigateur</a>',
                        },
                    ],
                },
            ],
            ui: {
                download: "Télécharger",
                useNow: "Utiliser maintenant",
                viewOnGithub: "GitHub",
                selectPlatform: "Choisir une plateforme",
                thisDevice: "Cet appareil",
                langSwitchAria: "Choisir la langue",
                otherProducts: "Autres produits",
                moreProducts: "Plus de produits",
                productLinks: "Produit",
                contact: "Contact",
                officialWebsite: "Site officiel",
                docs: "Documentation",
                changelog: "Historique des modifications",
            },
        },
        ru: {
            name: "Русский",
            page: {
                tagline: "Научно обоснованное решение для защиты конфиденциальности: обратимая мозаика, поддержка разных платформ, бесплатно и с открытым исходным кодом",
                taglineShort: "Обратимая мозаика для приватности",
                metaDesc:
                    "Научно обоснованное решение для защиты конфиденциальности с помощью обратимой мозаики. Поддержка разных платформ, бесплатно и с открытым исходным кодом. Q_____c и Q_c.",
            },
            sections: [
                {
                    id: "intro",
                    title: "Конфиденциальность важна. Мозаика на изображении должна быть обратимой.",
                    description:
                        "При хранении изображений конфиденциальные области часто закрывают мозаикой. Но иногда хочется, чтобы мозаика была временной и её можно было убрать при необходимости.",
                },
                {
                    id: "restore",
                    title: "Надёжность: восстановление после публикации в соцсетях, отправки в чатах и повторного сохранения",
                    description:
                        "С помощью дискретного преобразования Фурье конфиденциальные области преобразуются в изображения в частотной области. Их можно восстановить, даже если изображение было повторно сохранено, изменено в размере или сжато. Поддерживается повторное кодирование JPEG.",
                    cards: [
                        {
                            imageDesc:
                                "Для наилучшего результата не рекомендуется значительно изменять размер изображения повторно. При публикации в социальных сетях, которые ограничивают максимальный размер изображений, сначала уменьшите слишком большое изображение до рекомендованного платформой размера, а затем применяйте мозаику — это поможет избежать повторного масштабирования.",
                        },
                    ],
                },
                {
                    id: "password",
                    title: "Конфиденциальность: необязательное шифрование паролем",
                    description:
                        "К мозаике можно добавить пароль. Только тот, у кого есть пароль, сможет восстановить исходное изображение, что помогает предотвратить утечку конфиденциальных данных.",
                },
                {
                    id: "extension",
                    title: "Удобство: расширение для браузера",
                    description:
                        "С помощью расширения для браузера можно легко восстановить исходный вид изображений с мозаикой Q_____c на веб-страницах.",
                    cards: [
                        {
                            imageDesc: '<a href="https://github.com/qzrzz/Q_____c/releases"> → Расширение для браузера</a>',
                        },
                    ],
                },
            ],
            ui: {
                download: "Скачать",
                useNow: "Использовать сейчас",
                viewOnGithub: "GitHub",
                selectPlatform: "Выбрать платформу",
                thisDevice: "Это устройство",
                langSwitchAria: "Выбрать язык",
                otherProducts: "Другие продукты",
                moreProducts: "Другие продукты",
                productLinks: "Продукт",
                contact: "Контакты",
                officialWebsite: "Официальный сайт",
                docs: "Документация",
                changelog: "Список изменений",
            },
        },
    },
}

export default i18n
