codeunit 89320 "CG-AL-X126 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure ReservesABoxFor100x40AtMaximum50()
    begin
        // [WHEN] reserving a box for a 100x40 original with a maximum of 50
        // [THEN] the reserved box is 50x20
        VerifyThumbnailSize(100, 40, 50, 50, 20, '100x40 with a maximum of 50');
    end;

    [Test]
    procedure ReservesABoxFor40x100AtMaximum50()
    begin
        // [WHEN] reserving a box for a 40x100 original with a maximum of 50
        // [THEN] the reserved box is 20x50
        VerifyThumbnailSize(40, 100, 50, 20, 50, '40x100 with a maximum of 50');
    end;

    [Test]
    procedure ReservesABoxFor80x80AtMaximum32()
    begin
        // [WHEN] reserving a box for an 80x80 original with a maximum of 32
        // [THEN] the reserved box is 32x32
        VerifyThumbnailSize(80, 80, 32, 32, 32, '80x80 with a maximum of 32');
    end;

    [Test]
    procedure ReservesABoxFor100x40AtMaximum64()
    begin
        // [WHEN] reserving a box for a 100x40 original with a maximum of 64
        // [THEN] the reserved box is 64x26
        VerifyThumbnailSize(100, 40, 64, 64, 26, '100x40 with a maximum of 64');
    end;

    [Test]
    procedure ReservesABoxFor20x10AtMaximum15()
    begin
        // [WHEN] reserving a box for a 20x10 original with a maximum of 15
        // [THEN] the reserved box is 15x8
        VerifyThumbnailSize(20, 10, 15, 15, 8, '20x10 with a maximum of 15');
    end;

    // Protects the disclosed 41 -> 16 (not 17) example. Left exactly as
    // authored: it passes on the starter, and it must keep passing on the
    // starter, because it is the only disclosed example that rules out an
    // always-round-up "fix" - see NOTES.md.
    [Test]
    procedure ReservesABoxFor100x40AtMaximum41()
    begin
        // [WHEN] reserving a box for a 100x40 original with a maximum of 41
        // [THEN] the reserved box is 41x16, not 41x17
        VerifyThumbnailSize(100, 40, 41, 41, 16, '100x40 with a maximum of 41');
    end;

    [Test]
    procedure ReservesABoxFor20x10AtMaximum64()
    begin
        // [WHEN] reserving a box for a 20x10 original with a maximum of 64
        // [THEN] the reserved box stays 20x10
        VerifyThumbnailSize(20, 10, 64, 20, 10, '20x10 with a maximum of 64');
    end;

    [Test]
    procedure ReservesABoxFor20x10AtMaximum20()
    begin
        // [WHEN] reserving a box for a 20x10 original with a maximum of exactly 20
        // [THEN] the reserved box stays 20x10
        VerifyThumbnailSize(20, 10, 20, 20, 10, '20x10 with a maximum of exactly 20');
    end;

    [Test]
    procedure ReservesABoxFor100x2AtMaximum10()
    begin
        // [WHEN] reserving a box for a 100x2 original with a maximum of 10
        // [THEN] the reserved box is 10x1 - not an error and not 10x0
        VerifyThumbnailSize(100, 2, 10, 10, 1, '100x2 with a maximum of 10');
    end;

    [Test]
    procedure ReservesABoxFor100x10AtMaximum10()
    begin
        // [WHEN] reserving a box for a 100x10 original with a maximum of 10
        // [THEN] the reserved box is 10x1
        VerifyThumbnailSize(100, 10, 10, 10, 1, '100x10 with a maximum of 10');
    end;

    // Hidden generalization check for the 100-wide fixture family: the
    // description confirms the outcome at a handful of maximums only. The
    // expected height is derived independently of the codeunit under test
    // (integer half-up rounding of 63 * MaxDimension / 100), not by calling
    // the same Round the fix would call, so a fix built on a different
    // rounding convention that happened to coincide at the disclosed points
    // would still be caught here. AL stops at the first failing assertion,
    // so a failing run discloses exactly one maximum, not the whole range.
    [Test]
    procedure ReservesBoxesFor100x63AtEveryMaximumUpToNinetyNine()
    var
        ThumbnailSizer: Codeunit "CG X126 Thumbnail Sizer";
        ThumbnailWidth: Integer;
        ThumbnailHeight: Integer;
        ExpectedHeight: Integer;
        MaxDimension: Integer;
    begin
        for MaxDimension := 1 to 99 do begin
            ExpectedHeight := (2 * 63 * MaxDimension + 100) div (2 * 100);

            ThumbnailWidth := -7;
            ThumbnailHeight := -9;
            ThumbnailSizer.CalculateThumbnailSize(100, 63, MaxDimension, ThumbnailWidth, ThumbnailHeight);
            Assert.AreEqual(MaxDimension, ThumbnailWidth,
                StrSubstNo('Expected the reserved box width for a 100x63 original with a maximum of %1', MaxDimension));
            Assert.AreEqual(ExpectedHeight, ThumbnailHeight,
                StrSubstNo('Expected the reserved box height for a 100x63 original with a maximum of %1', MaxDimension));
        end;
    end;

    // Mirrors the sweep above with height as the longer side, so a fix that
    // only generalizes for one orientation still gets caught.
    [Test]
    procedure ReservesBoxesFor63x100AtEveryMaximumUpToNinetyNine()
    var
        ThumbnailSizer: Codeunit "CG X126 Thumbnail Sizer";
        ThumbnailWidth: Integer;
        ThumbnailHeight: Integer;
        ExpectedWidth: Integer;
        MaxDimension: Integer;
    begin
        for MaxDimension := 1 to 99 do begin
            ExpectedWidth := (2 * 63 * MaxDimension + 100) div (2 * 100);

            ThumbnailWidth := -7;
            ThumbnailHeight := -9;
            ThumbnailSizer.CalculateThumbnailSize(63, 100, MaxDimension, ThumbnailWidth, ThumbnailHeight);
            Assert.AreEqual(ExpectedWidth, ThumbnailWidth,
                StrSubstNo('Expected the reserved box width for a 63x100 original with a maximum of %1', MaxDimension));
            Assert.AreEqual(MaxDimension, ThumbnailHeight,
                StrSubstNo('Expected the reserved box height for a 63x100 original with a maximum of %1', MaxDimension));
        end;
    end;

    // Hidden generalization check for the smallest-shorter-side family: an
    // original only 2 pixels tall, swept across every maximum. Grades the
    // 1-pixel-floor rule across its whole region (maximums where the
    // proportional math alone would round to 0) and past its exit boundary
    // (maximums past 74, where the reserved height genuinely becomes 2 and
    // the floor no longer applies).
    [Test]
    procedure ReservesBoxesFor100x2AtEveryMaximumUpToNinetyNine()
    var
        ThumbnailSizer: Codeunit "CG X126 Thumbnail Sizer";
        ThumbnailWidth: Integer;
        ThumbnailHeight: Integer;
        ExpectedHeight: Integer;
        MaxDimension: Integer;
    begin
        for MaxDimension := 1 to 99 do begin
            ExpectedHeight := (2 * 2 * MaxDimension + 100) div (2 * 100);
            if ExpectedHeight < 1 then
                ExpectedHeight := 1;

            ThumbnailWidth := -7;
            ThumbnailHeight := -9;
            ThumbnailSizer.CalculateThumbnailSize(100, 2, MaxDimension, ThumbnailWidth, ThumbnailHeight);
            Assert.AreEqual(MaxDimension, ThumbnailWidth,
                StrSubstNo('Expected the reserved box width for a 100x2 original with a maximum of %1', MaxDimension));
            Assert.AreEqual(ExpectedHeight, ThumbnailHeight,
                StrSubstNo('Expected the reserved box height for a 100x2 original with a maximum of %1', MaxDimension));
        end;
    end;

    // Hidden generalization check for the already-fits family: a 20x10
    // original swept across every maximum up to 40. Grades the never-enlarge
    // rule across its whole region (maximums >= 20, where the box must stay
    // 20x10) instead of at the two disclosed points, and folds in the
    // maximum-just-below-the-longer-side boundary without naming it.
    [Test]
    procedure ReservesBoxesFor20x10AtEveryMaximumUpToForty()
    var
        ThumbnailSizer: Codeunit "CG X126 Thumbnail Sizer";
        ThumbnailWidth: Integer;
        ThumbnailHeight: Integer;
        ExpectedWidth: Integer;
        ExpectedHeight: Integer;
        MaxDimension: Integer;
    begin
        for MaxDimension := 1 to 40 do begin
            if MaxDimension >= 20 then begin
                ExpectedWidth := 20;
                ExpectedHeight := 10;
            end else begin
                ExpectedWidth := MaxDimension;
                ExpectedHeight := (2 * 10 * MaxDimension + 20) div (2 * 20);
            end;

            ThumbnailWidth := -7;
            ThumbnailHeight := -9;
            ThumbnailSizer.CalculateThumbnailSize(20, 10, MaxDimension, ThumbnailWidth, ThumbnailHeight);
            Assert.AreEqual(ExpectedWidth, ThumbnailWidth,
                StrSubstNo('Expected the reserved box width for a 20x10 original with a maximum of %1', MaxDimension));
            Assert.AreEqual(ExpectedHeight, ThumbnailHeight,
                StrSubstNo('Expected the reserved box height for a 20x10 original with a maximum of %1', MaxDimension));
        end;
    end;

    local procedure VerifyThumbnailSize(OriginalWidth: Integer; OriginalHeight: Integer; MaxDimension: Integer; ExpectedWidth: Integer; ExpectedHeight: Integer; SourceDescription: Text)
    var
        ThumbnailSizer: Codeunit "CG X126 Thumbnail Sizer";
        ThumbnailWidth: Integer;
        ThumbnailHeight: Integer;
    begin
        ThumbnailWidth := -7;
        ThumbnailHeight := -9;
        ThumbnailSizer.CalculateThumbnailSize(OriginalWidth, OriginalHeight, MaxDimension, ThumbnailWidth, ThumbnailHeight);
        Assert.AreEqual(ExpectedWidth, ThumbnailWidth,
            StrSubstNo('Expected the reserved box width for a %1 original', SourceDescription));
        Assert.AreEqual(ExpectedHeight, ThumbnailHeight,
            StrSubstNo('Expected the reserved box height for a %1 original', SourceDescription));
    end;
}
