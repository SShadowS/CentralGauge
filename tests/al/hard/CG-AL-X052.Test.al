codeunit 80342 "CG-AL-X052 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearState()
    var
        Quote: Record "CG X052 Quote";
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts on assertion
        // failure and never reaches end-of-test cleanup, which can leave
        // rows behind on the shared container.
        Quote.DeleteAll();
    end;

    local procedure SeedQuote(No: Code[20]; SeedQty: Integer; SeedRate: Integer; SeedFee: Integer; SeedTotal: Integer)
    var
        Quote: Record "CG X052 Quote";
    begin
        Quote.Init();
        Quote."No." := No;
        Quote.Qty := SeedQty;
        Quote.Rate := SeedRate;
        Quote.Fee := SeedFee;
        Quote.Total := SeedTotal;
        Quote.Insert();
    end;

    [Test]
    procedure SetTermsNormalizesQuantityUpAndAppliesHighTier()
    var
        Quote: Record "CG X052 Quote";
        Decoy: Record "CG X052 Quote";
        Clerk: Codeunit "CG X052 Clerk";
    begin
        // [GIVEN] a decoy row SetTerms must never touch, and the target row
        // seeded at a LOW-tier quantity so a rate-first Validate order would
        // derive the tier from the WRONG (stale, low-tier) quantity
        ClearState();
        SeedQuote('DECOY1', 88, 444, 5, 39077);
        SeedQuote('Q1', 6, 30, 0, 111);

        // [WHEN]
        Clerk.SetTerms('Q1', 100, 17);

        // [THEN] read back the persisted row directly, not an in-memory var,
        // so the assertion proves the row was actually re-persisted
        Assert.IsTrue(Quote.Get('Q1'), 'Q1 row must still exist');
        Assert.AreEqual(1832, Quote.Total, 'Quote total must match the sealed tariff for the applied terms.');

        Assert.IsTrue(Decoy.Get('DECOY1'), 'decoy row must still exist');
        Assert.AreEqual(88, Decoy.Qty, 'decoy Qty must be untouched');
        Assert.AreEqual(444, Decoy.Rate, 'decoy Rate must be untouched');
        Assert.AreEqual(5, Decoy.Fee, 'decoy Fee must be untouched');
        Assert.AreEqual(39077, Decoy.Total, 'decoy Total must be untouched');

        ClearState();
    end;

    [Test]
    procedure SetTermsNormalizesQuantityDownAndAppliesLowTier()
    var
        Quote: Record "CG X052 Quote";
        Decoy: Record "CG X052 Quote";
        Clerk: Codeunit "CG X052 Clerk";
    begin
        // [GIVEN] the target row seeded at a HIGH-tier quantity so a
        // rate-first Validate order would derive the tier from the WRONG
        // (stale, high-tier) quantity - crosses the boundary the opposite
        // direction from the first case, so this isn't a one-off coincidence
        ClearState();
        SeedQuote('DECOY2', 61, 233, 8, 14221);
        SeedQuote('Q2', 18, 45, 0, 222);

        // [WHEN]
        Clerk.SetTerms('Q2', 60, 8);

        // [THEN]
        Assert.IsTrue(Quote.Get('Q2'), 'Q2 row must still exist');
        Assert.AreEqual(566, Quote.Total, 'Quote total must match the sealed tariff for the applied terms.');

        Assert.IsTrue(Decoy.Get('DECOY2'), 'decoy row must still exist');
        Assert.AreEqual(61, Decoy.Qty, 'decoy Qty must be untouched');
        Assert.AreEqual(233, Decoy.Rate, 'decoy Rate must be untouched');
        Assert.AreEqual(8, Decoy.Fee, 'decoy Fee must be untouched');
        Assert.AreEqual(14221, Decoy.Total, 'decoy Total must be untouched');

        ClearState();
    end;

    [Test]
    procedure SetTermsNormalizesQuantityWithinSameTier()
    var
        Quote: Record "CG X052 Quote";
        Decoy: Record "CG X052 Quote";
        Clerk: Codeunit "CG X052 Clerk";
    begin
        // [GIVEN] target row seeded so the seed quantity and the normalized
        // new quantity fall in the SAME tier - Validate order can't change
        // the tiered rate here, isolating normalization (independent of
        // order) as the thing this case catches
        ClearState();
        SeedQuote('DECOY3', 53, 177, 2, 9383);
        SeedQuote('Q3', 17, 20, 0, 333);

        // [WHEN]
        Clerk.SetTerms('Q3', 40, 25);

        // [THEN]
        Assert.IsTrue(Quote.Get('Q3'), 'Q3 row must still exist');
        Assert.AreEqual(790, Quote.Total, 'Quote total must match the sealed tariff for the applied terms.');

        Assert.IsTrue(Decoy.Get('DECOY3'), 'decoy row must still exist');
        Assert.AreEqual(53, Decoy.Qty, 'decoy Qty must be untouched');
        Assert.AreEqual(177, Decoy.Rate, 'decoy Rate must be untouched');
        Assert.AreEqual(2, Decoy.Fee, 'decoy Fee must be untouched');
        Assert.AreEqual(9383, Decoy.Total, 'decoy Total must be untouched');

        ClearState();
    end;
}
