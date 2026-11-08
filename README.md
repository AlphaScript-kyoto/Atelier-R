# create_picture — SDXL 画像生成（ComfyUI）

手元の Radeon RX 9060 XT で、SDXL 系チェックポイントとオリヴィア LoRA を使って画像を作るための ComfyUI 環境です。

NVIDIA の GPU は載っていないので、AMD 公式の **ROCm 10.0 版 PyTorch** で動かします。チェックポイントは 1 つ約 6.6GB あるため、コピーはせず、今あるファイルを ComfyUI から直接読みます。

## プロジェクトの概要

- 開くと、ノードではなく「Atelier R」の画面になります。
- 左で基礎モデル、LoRA、縦横比、枚数を選び、中央の文章から画像を作ります。
- モデルは Illustrious / SDXL 系の 3 つです。LoRA「オリヴィア」も選べます。
- 裏側では ComfyUI が動いています。ノードを直接触りたいときだけ `start_nodes.bat` を使います。

| 項目 | 値 |
| --- | --- |
| サイズ | 832 x 1216 |
| サンプラー | euler_ancestral |
| ステップ | 28 |
| CFG | 5.5 |
| シード | 20261108 |
| CLIP skip | 2（`CLIP Set Last Layer` の値 `-2`） |

## 各ファイルの役割

| ファイル / フォルダ | 役割 |
| --- | --- |
| `start_comfyui.bat` | Atelier R を開くバッチです。普段はこれをダブルクリックします。 |
| `start_nodes.bat` | ノードを線でつなぐ上級者向けの画面です。普段は使いません。 |
| `studio/` | Atelier R のプログラムと、見た目のファイルです。 |
| `ComfyUI/` | ComfyUI 本体と、Python 3.13 の仮想環境（`.venv`）です。 |
| `ComfyUI/extra_model_paths.yaml` | 既存モデルの置き場所を ComfyUI に教える設定です。 |
| `ComfyUI/constraints-rocm.txt` | ライブラリを入れ直しても、PyTorch が GPU 非対応の通常版に戻らないようにする指定です。 |
| `workflows/sdxl_olivia.json` | ノード画面で同じ条件を再現するためのワークフローです。Atelier R では使いません。 |
| `Lora/chekpoint/` | チェックポイント 3 つです。フォルダ名はもともとこの綴りです。 |
| `Lora/【オリヴィア】....safetensors` | オリヴィア LoRA の実体です。 |
| `models/loras/olivia.safetensors` | 上の LoRA へのリンクです。中身は複製していません。 |
| `Lora/kaggle_olivia_generator.ipynb` | Kaggle 上で同じモデルを比べるためのノートです。この PC では使いません。 |
| `ComfyUI/output/` | 生成した画像の保存先です。起動後に作られます。 |

GitHub に上げているのは、画面のプログラムと説明です。チェックポイント、LoRA、ComfyUI 本体は数 GB あるため、リポジトリには入れていません。この PC のフォルダには、これまでどおり残っています。

チェックポイントは次の 3 つです。

1. `1_animemixillustrious_v8.safetensors`（AnimeMix v8）
2. `2_EstellaXL.safetensors`（EstellaXL）
3. `3_HolyMix_00002_.safetensors`（Holy Mix。ワークフローの初期選択）

## 使い方

### 1. Atelier R を開く

エクスプローラーで `start_comfyui.bat` をダブルクリックします。起動すると、ブラウザで生成画面が自動的に開きます。

すでに起動しているときに、もう一度このファイルを押した場合は「Atelier R はすでに開いています」と表示され、新しい画面は作らず、同じアドレスをブラウザで開きます。

ブラウザが開かないときは、次のアドレスを開いてください。

```text
http://127.0.0.1:8189
```

ターミナルから起動する場合は、このプロジェクトのフォルダで次を実行します。

```powershell
.\start_comfyui.bat
```

終了するときは、黒い画面を選択して `Ctrl + C` を押します。

### 2. 左で設定して、中央で生成する

1. **基礎モデル** で Holy Mix、EstellaXL、AnimeMix v8 のどれかを選びます。
2. **LoRA** で Olivia von Ecclesia を選ぶと、強さのつまみと 4 つのトリガーワードが出ます。言葉をクリックすると中央の入力欄に追加されます。**すべて使用** で 4 つまとめて追加できます。
3. **縦横比** は縦向きと横向きが対になっています。`9:16` が初期選択です。比率をクリックすると、下の幅と高さがそのサイズに変わります。その下の **縦 / 横** と解像度の一覧で、FHD・WQHD・4K・8K を選ぶと、向きに合わせて幅と高さが入ります。数字を自分で変えると **カスタム** になります。幅と高さは 512〜7680、8 の倍数で、合計は 8K（7680×4320）までです。1536 より長い辺は、いったんその比率のまま描いてから指定サイズまで拡大します。
4. **一度に作る枚数** は数字を直接入れるか、入力欄の上下の三角で増減します。1 枚未満や 99 枚より多くは指定できません。枚数が多いとメモリが足りなくなることがあります。
5. 中央に描きたい内容を書いて、**生成する** を押します。待ち時間はプログレスバーで分かります。モデルを読み込んでいる間はバーが動き、描き始めると「何ステップ目か」が出ます。
6. 画像は画面に出ます。同時に `ComfyUI/output/` へ自動で保存されるので、別に保存操作はいりません。1回の生成は、使ったプロンプトごとのまとまりになります。プロンプトにカーソルを合わせると **プロンプトを再利用** が出て、押すと今の入力欄の後ろに足されます。生成は始まりません。
7. 絵をクリックすると、使った条件と保存先のファイル名を確認でき、**同じ条件で再生成** もできます。暗い余白か × で閉じられます。矢印の移動は、そのまとまりの中の絵だけを順番に回り、最後の次は同じまとまりの最初に戻ります。

最初の 1 枚はモデルを読み込むので、1 分前後かかることがあります。2 枚目以降は短くなります。

ノードを自分でつなぎたいときは、Atelier R を終了してから `start_nodes.bat` を実行し、ブラウザで `http://127.0.0.1:8188` を開きます。

## 最初の準備（もう一度入れ直すとき）

普段の起動では、下の作業は不要です。PC を変えたときや、環境を作り直すときだけ実行してください。

この PC の通常の Python は 3.14 です。ComfyUI の AMD 向け PyTorch は **Python 3.13** が必要なので、3.14 では入れないでください。

```powershell
winget install -e --id Python.Python.3.13 --scope user --accept-package-agreements --accept-source-agreements

cd ComfyUI
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install --index-url https://stable.repo.amd.com/rocm/whl-next/ --extra-index-url https://pypi.org/simple "torch[device-gfx1200]==2.13.0+rocm10.0.0" "torchvision[device-gfx1200]==0.28.0+rocm10.0.0" "torchaudio==2.11.0.2+rocm10.0.0"
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -c constraints-rocm.txt --extra-index-url https://stable.repo.amd.com/rocm/whl-next/
```

`device-gfx1200` は RX 9060 XT 用です。別の AMD GPU では、ComfyUI の README にある対応表を見て名前を変えてください。

GPU が認識されているかは、仮想環境で次を実行すると確認できます。

```powershell
cd ComfyUI
.\.venv\Scripts\python.exe -c "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'GPUなし')"
```

ROCm 版の PyTorch は、AMD GPU も `torch.cuda` という名前で扱います。`True` と `Radeon RX 9060 XT` が出れば成功です。

## アップデート

ComfyUI 本体だけを新しくする場合:

```powershell
cd ComfyUI
git pull
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -c constraints-rocm.txt --extra-index-url https://stable.repo.amd.com/rocm/whl-next/
```

## 困ったとき

- ブラウザが開いてもモデル一覧が空: `extra_model_paths.yaml` のパスを確認し、ComfyUI を起動し直してください。
- `Python の仮想環境が見つかりません`: 「最初の準備」を実行してください。
- 生成中にメモリ不足と出る: 画像サイズを 832x1216 のまま、他の重いアプリを閉じてから再実行してください。それでも足りないときは `start_comfyui.bat` の起動行を `main.py --lowvram` に変えます。
- 起動画面に GPU 名が出ない: AMD Software（Adrenalin）が最新か確認してください。この環境は Windows 11 と Python 3.13 を前提にしています。
#   A t e l i e r - R  
 