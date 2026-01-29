use image::DynamicImage;
use std::path::Path;

#[derive(Debug, Clone, Copy)]
pub enum SimilarityAlgorithm {
    Histogram,
    SSIM,
    FrameDiff,
}

impl SimilarityAlgorithm {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "histogram" => Ok(Self::Histogram),
            "ssim" => Ok(Self::SSIM),
            "frame_diff" => Ok(Self::FrameDiff),
            _ => Err(format!("未知的算法: {}", s)),
        }
    }
}

/// 计算两张图片的相似度 (0.0-1.0, 1.0表示完全相同)
pub fn calculate_similarity(
    img1_path: &str,
    img2_path: &str,
    algorithm: SimilarityAlgorithm,
) -> Result<f64, String> {
    let img1 = image::open(Path::new(img1_path))
        .map_err(|e| format!("无法打开图片1: {}", e))?;
    let img2 = image::open(Path::new(img2_path))
        .map_err(|e| format!("无法打开图片2: {}", e))?;

    match algorithm {
        SimilarityAlgorithm::Histogram => histogram_similarity(&img1, &img2),
        SimilarityAlgorithm::SSIM => ssim_similarity(&img1, &img2),
        SimilarityAlgorithm::FrameDiff => frame_diff_similarity(&img1, &img2),
    }
}

/// 直方图相似度算法
fn histogram_similarity(img1: &DynamicImage, img2: &DynamicImage) -> Result<f64, String> {
    // 转换为灰度图
    let gray1 = img1.to_luma8();
    let gray2 = img2.to_luma8();

    if gray1.dimensions() != gray2.dimensions() {
        return Err("图片尺寸不匹配".to_string());
    }

    // 计算直方图 (256个bin)
    let mut hist1 = vec![0u32; 256];
    let mut hist2 = vec![0u32; 256];

    for pixel in gray1.pixels() {
        hist1[pixel[0] as usize] += 1;
    }

    for pixel in gray2.pixels() {
        hist2[pixel[0] as usize] += 1;
    }

    // 归一化直方图
    let total_pixels = (gray1.width() * gray1.height()) as f64;
    let hist1_norm: Vec<f64> = hist1.iter().map(|&x| x as f64 / total_pixels).collect();
    let hist2_norm: Vec<f64> = hist2.iter().map(|&x| x as f64 / total_pixels).collect();

    // 使用巴氏距离 (Bhattacharyya distance) 计算相似度
    let mut bc_coeff = 0.0;
    for i in 0..256 {
        bc_coeff += (hist1_norm[i] * hist2_norm[i]).sqrt();
    }

    Ok(bc_coeff)
}

/// SSIM (结构相似性) 算法
fn ssim_similarity(img1: &DynamicImage, img2: &DynamicImage) -> Result<f64, String> {
    let gray1 = img1.to_luma8();
    let gray2 = img2.to_luma8();

    if gray1.dimensions() != gray2.dimensions() {
        return Err("图片尺寸不匹配".to_string());
    }

    let (width, height) = gray1.dimensions();

    // SSIM 常量
    let k1 = 0.01;
    let k2 = 0.03;
    let l = 255.0; // 像素值范围
    let c1 = (k1 * l) * (k1 * l);
    let c2 = (k2 * l) * (k2 * l);

    // 计算均值
    let mut sum1 = 0.0;
    let mut sum2 = 0.0;
    let total_pixels = (width * height) as f64;

    for y in 0..height {
        for x in 0..width {
            sum1 += gray1.get_pixel(x, y)[0] as f64;
            sum2 += gray2.get_pixel(x, y)[0] as f64;
        }
    }

    let mean1 = sum1 / total_pixels;
    let mean2 = sum2 / total_pixels;

    // 计算方差和协方差
    let mut var1 = 0.0;
    let mut var2 = 0.0;
    let mut covar = 0.0;

    for y in 0..height {
        for x in 0..width {
            let p1 = gray1.get_pixel(x, y)[0] as f64;
            let p2 = gray2.get_pixel(x, y)[0] as f64;

            let diff1 = p1 - mean1;
            let diff2 = p2 - mean2;

            var1 += diff1 * diff1;
            var2 += diff2 * diff2;
            covar += diff1 * diff2;
        }
    }

    var1 /= total_pixels;
    var2 /= total_pixels;
    covar /= total_pixels;

    // 计算 SSIM
    let numerator = (2.0 * mean1 * mean2 + c1) * (2.0 * covar + c2);
    let denominator = (mean1 * mean1 + mean2 * mean2 + c1) * (var1 + var2 + c2);

    let ssim = numerator / denominator;

    // SSIM 范围是 [-1, 1]，转换为 [0, 1]
    Ok((ssim + 1.0) / 2.0)
}

/// 帧差异算法 (简单的像素差异)
fn frame_diff_similarity(img1: &DynamicImage, img2: &DynamicImage) -> Result<f64, String> {
    let gray1 = img1.to_luma8();
    let gray2 = img2.to_luma8();

    if gray1.dimensions() != gray2.dimensions() {
        return Err("图片尺寸不匹配".to_string());
    }

    let (width, height) = gray1.dimensions();
    let mut total_diff = 0.0;
    let total_pixels = (width * height) as f64;

    for y in 0..height {
        for x in 0..width {
            let p1 = gray1.get_pixel(x, y)[0] as f64;
            let p2 = gray2.get_pixel(x, y)[0] as f64;
            total_diff += (p1 - p2).abs();
        }
    }

    // 归一化到 [0, 1]，然后转换为相似度
    let avg_diff = total_diff / (total_pixels * 255.0);
    let similarity = 1.0 - avg_diff;

    Ok(similarity)
}
