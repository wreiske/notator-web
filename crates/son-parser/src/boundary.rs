//! Boundary marker scanning and splitting.
//!
//! .SON files delimit track data with 4-byte boundary markers:
//! - Type A: 7F FF FF FF
//! - Type B: 00 0F FF FF

use crate::types::{BoundaryInfo, BoundaryType};

const BOUNDARY_A: [u8; 4] = [0x7F, 0xFF, 0xFF, 0xFF];
const BOUNDARY_B: [u8; 4] = [0x00, 0x0F, 0xFF, 0xFF];

/// Result of splitting data on boundary markers.
pub struct BoundarySplit {
    /// Data chunks between boundaries
    pub chunks: Vec<Vec<u8>>,
    /// Boundary metadata for each chunk
    pub boundaries: Vec<BoundaryInfo>,
    /// Padding before the first boundary
    pub pre_boundary_padding: Vec<u8>,
}

/// Check if data at `pos` matches a boundary marker.
fn matches_boundary(data: &[u8], pos: usize) -> Option<BoundaryType> {
    if pos + 4 > data.len() {
        return None;
    }
    let seg = &data[pos..pos + 4];
    if seg == BOUNDARY_A {
        Some(BoundaryType::A)
    } else if seg == BOUNDARY_B {
        Some(BoundaryType::B)
    } else {
        None
    }
}

/// Split data starting at `start_offset` into chunks delimited by boundary markers.
pub fn split_on_boundaries(data: &[u8], start_offset: usize) -> BoundarySplit {
    let region = &data[start_offset..];
    let mut positions: Vec<(usize, BoundaryType)> = Vec::new();

    // Find all boundary positions
    if region.len() >= 4 {
        for i in 0..=region.len() - 4 {
            if let Some(btype) = matches_boundary(region, i) {
                positions.push((i, btype));
            }
        }
    }

    // Pre-boundary padding
    let first_pos = positions.first().map(|(p, _)| *p).unwrap_or(region.len());
    let pre_boundary_padding = region[..first_pos].to_vec();

    let mut chunks = Vec::with_capacity(positions.len());
    let mut boundaries = Vec::with_capacity(positions.len());

    for (idx, (pos, btype)) in positions.iter().enumerate() {
        boundaries.push(BoundaryInfo {
            boundary_type: *btype,
            file_offset: start_offset + pos,
        });

        let start = pos + 4;
        let end = if idx + 1 < positions.len() {
            positions[idx + 1].0
        } else {
            region.len()
        };

        if end > start {
            chunks.push(region[start..end].to_vec());
        } else {
            chunks.push(Vec::new());
        }
    }

    BoundarySplit {
        chunks,
        boundaries,
        pre_boundary_padding,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_matches_boundary_a() {
        let data = [0x7F, 0xFF, 0xFF, 0xFF, 0x01, 0x02];
        assert_eq!(matches_boundary(&data, 0), Some(BoundaryType::A));
        assert_eq!(matches_boundary(&data, 1), None);
    }

    #[test]
    fn test_matches_boundary_b() {
        let data = [0x00, 0x0F, 0xFF, 0xFF, 0x03, 0x04];
        assert_eq!(matches_boundary(&data, 0), Some(BoundaryType::B));
    }

    #[test]
    fn test_split_simple() {
        let mut data = vec![0u8; 10]; // padding
        data.extend_from_slice(&BOUNDARY_A);
        data.extend_from_slice(&[1, 2, 3]); // chunk 0
        data.extend_from_slice(&BOUNDARY_B);
        data.extend_from_slice(&[4, 5]); // chunk 1

        let result = split_on_boundaries(&data, 0);
        assert_eq!(result.chunks.len(), 2);
        assert_eq!(result.chunks[0], vec![1, 2, 3]);
        assert_eq!(result.chunks[1], vec![4, 5]);
        assert_eq!(result.pre_boundary_padding.len(), 10);
        assert_eq!(result.boundaries.len(), 2);
        assert_eq!(result.boundaries[0].boundary_type, BoundaryType::A);
        assert_eq!(result.boundaries[1].boundary_type, BoundaryType::B);
    }
}
