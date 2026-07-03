codeunit 80334 "CG-AL-X045 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearState()
    var
        Line: Record "CG X045 Line";
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts on assertion
        // failure and never reaches end-of-test cleanup, which can leave
        // rows behind on the shared container.
        Line.DeleteAll();
    end;

    local procedure SeedLine(No: Code[20]; SeedQuantity: Integer; SeedPrice: Integer)
    var
        Line: Record "CG X045 Line";
    begin
        Line.Init();
        Line."No." := No;
        Line.Quantity := SeedQuantity;
        Line.Price := SeedPrice;
        Line.Amount := SeedQuantity * SeedPrice;
        Line.Insert();
    end;

    [Test]
    procedure ApplyTermsNormalizesQuantityUpAndAppliesHighTier()
    var
        Line: Record "CG X045 Line";
        Decoy: Record "CG X045 Line";
        Clerk: Codeunit "CG X045 Clerk";
    begin
        // [GIVEN] a decoy row ApplyTerms must never touch, and the target
        // row seeded at a LOW-tier quantity so a price-first Validate order
        // would derive the tier from the WRONG (stale, low-tier) quantity
        ClearState();
        SeedLine('DECOY1', 99, 555);
        SeedLine('L1', 3, 999);

        // [WHEN]
        Clerk.ApplyTerms('L1', 100, 14);

        // [THEN] read back the persisted row directly, not an in-memory var,
        // so the assertion proves the row was actually re-persisted
        Assert.IsTrue(Line.Get('L1'), 'L1 row must still exist');
        Assert.AreEqual(16, Line.Quantity, 'Quantity must be normalized up to the next multiple of 4');
        Assert.AreEqual(93, Line.Price, 'Price must be the offered price discounted under the NORMALIZED quantity''s tier');
        Assert.AreEqual(1488, Line.Amount, 'Amount must reflect the normalized quantity and the effective price');

        Assert.IsTrue(Decoy.Get('DECOY1'), 'decoy row must still exist');
        Assert.AreEqual(99, Decoy.Quantity, 'decoy Quantity must be untouched');
        Assert.AreEqual(555, Decoy.Price, 'decoy Price must be untouched');
        Assert.AreEqual(99 * 555, Decoy.Amount, 'decoy Amount must be untouched');

        ClearState();
    end;

    [Test]
    procedure ApplyTermsNormalizesQuantityDownAndAppliesLowTier()
    var
        Line: Record "CG X045 Line";
        Decoy: Record "CG X045 Line";
        Clerk: Codeunit "CG X045 Clerk";
    begin
        // [GIVEN] the target row seeded at a HIGH-tier quantity so a
        // price-first Validate order would derive the tier from the WRONG
        // (stale, high-tier) quantity - crosses the boundary the opposite
        // direction from the first case, so this isn't a one-off coincidence
        ClearState();
        SeedLine('DECOY2', 77, 321);
        SeedLine('L2', 20, 700);

        // [WHEN]
        Clerk.ApplyTerms('L2', 50, 5);

        // [THEN]
        Assert.IsTrue(Line.Get('L2'), 'L2 row must still exist');
        Assert.AreEqual(8, Line.Quantity, 'Quantity must be normalized down to the next multiple of 4 that is >= the requested quantity');
        Assert.AreEqual(48, Line.Price, 'Price must be the offered price discounted under the NORMALIZED quantity''s tier');
        Assert.AreEqual(384, Line.Amount, 'Amount must reflect the normalized quantity and the effective price');

        Assert.IsTrue(Decoy.Get('DECOY2'), 'decoy row must still exist');
        Assert.AreEqual(77, Decoy.Quantity, 'decoy Quantity must be untouched');
        Assert.AreEqual(321, Decoy.Price, 'decoy Price must be untouched');
        Assert.AreEqual(77 * 321, Decoy.Amount, 'decoy Amount must be untouched');

        ClearState();
    end;

    [Test]
    procedure ApplyTermsNormalizesQuantityWithinSameTier()
    var
        Line: Record "CG X045 Line";
        Decoy: Record "CG X045 Line";
        Clerk: Codeunit "CG X045 Clerk";
    begin
        // [GIVEN] target row seeded so the seed quantity and the normalized
        // new quantity fall in the SAME tier - Validate order can't change
        // the tiered price here, isolating normalization (independent of
        // order) as the thing this case catches
        ClearState();
        SeedLine('DECOY3', 42, 111);
        SeedLine('L3', 13, 300);

        // [WHEN]
        Clerk.ApplyTerms('L3', 80, 21);

        // [THEN]
        Assert.IsTrue(Line.Get('L3'), 'L3 row must still exist');
        Assert.AreEqual(24, Line.Quantity, 'Quantity must be normalized up to the next multiple of 4 even when the tier does not change');
        Assert.AreEqual(73, Line.Price, 'Price must be the offered price discounted under the tier');
        Assert.AreEqual(1752, Line.Amount, 'Amount must reflect the normalized quantity and the effective price');

        Assert.IsTrue(Decoy.Get('DECOY3'), 'decoy row must still exist');
        Assert.AreEqual(42, Decoy.Quantity, 'decoy Quantity must be untouched');
        Assert.AreEqual(111, Decoy.Price, 'decoy Price must be untouched');
        Assert.AreEqual(42 * 111, Decoy.Amount, 'decoy Amount must be untouched');

        ClearState();
    end;
}
