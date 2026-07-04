codeunit 80340 "CG-AL-X050 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearState()
    var
        Entry: Record "CG X050 Entry";
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts on assertion
        // failure and never reaches end-of-test cleanup, which can leave
        // rows behind on the shared container.
        Entry.DeleteAll();
    end;

    local procedure SeedEntry(EntryNo: Integer; BatchId: Integer; Kind: Enum "CG X050 Entry Kind"; Amount: Integer)
    var
        Entry: Record "CG X050 Entry";
    begin
        Entry.Init();
        Entry."Entry No." := EntryNo;
        Entry."Batch Id" := BatchId;
        Entry.Kind := Kind;
        Entry.Amount := Amount;
        Entry.Insert();
    end;

    [Test]
    procedure BatchDigestCoversAllEntriesAndPicksTheTrueNewestForBatchSeven()
    var
        Entry: Record "CG X050 Entry";
        Decoy: Record "CG X050 Entry";
        Teller: Codeunit "CG X050 Teller";
        Result: Integer;
    begin
        // [GIVEN] batch 7: anchor is the lowest-Amount Normal entry (E10=40);
        // the highest-Amount entry (E12=90) is a DIFFERENT row from the
        // highest-Entry-No. entry (E13=55, a Cancelled kind) - a wrong "newest"
        // pick and an undercounted sum land on different rows/values, so a
        // wrong implementation can't accidentally cancel out.
        ClearState();
        SeedEntry(10, 7, "CG X050 Entry Kind"::Normal, 40);
        SeedEntry(11, 7, "CG X050 Entry Kind"::Cancelled, 25);
        SeedEntry(12, 7, "CG X050 Entry Kind"::Normal, 90);
        SeedEntry(13, 7, "CG X050 Entry Kind"::Cancelled, 55);

        // [GIVEN] a decoy batch that BatchDigest(7) must never read from
        SeedEntry(90, 99, "CG X050 Entry Kind"::Normal, 1000);
        SeedEntry(91, 99, "CG X050 Entry Kind"::Cancelled, 2000);

        // [WHEN]
        Result := Teller.BatchDigest(7);

        // [THEN] one contract-only assertion - the digest is a composite of
        // three contributions, so this message deliberately does not say
        // which one is wrong
        Assert.AreEqual(40760, Result, 'Batch 7 digest must match its specification.');

        // [THEN] the decoy batch must be completely untouched
        Assert.IsTrue(Decoy.Get(90), 'Decoy entry 90 must still exist');
        Assert.AreEqual(1000, Decoy.Amount, 'Decoy batch 99 entry 90 must be untouched');
        Assert.IsTrue(Decoy.Get(91), 'Decoy entry 91 must still exist');
        Assert.AreEqual(2000, Decoy.Amount, 'Decoy batch 99 entry 91 must be untouched');

        // [THEN] BatchDigest must be read-only over the ledger
        Entry.Reset();
        Assert.AreEqual(6, Entry.Count(), 'BatchDigest must not alter the ledger.');

        ClearState();
    end;

    [Test]
    procedure BatchDigestCoversAllEntriesAndPicksTheTrueNewestForBatchEight()
    var
        Entry: Record "CG X050 Entry";
        Decoy: Record "CG X050 Entry";
        Teller: Codeunit "CG X050 Teller";
        Result: Integer;
    begin
        // [GIVEN] batch 8: a differently-shaped, independently opaque seed
        // set (different anchor, amounts, and entry numbers than batch 7) so
        // the discrimination isn't tied to one coincidental delta - the true
        // newest (E23) is again a Cancelled entry, hidden from any Kind-filtered
        // scan regardless of which key or iteration order reads it
        ClearState();
        SeedEntry(20, 8, "CG X050 Entry Kind"::Normal, 12);
        SeedEntry(21, 8, "CG X050 Entry Kind"::Cancelled, 7);
        SeedEntry(22, 8, "CG X050 Entry Kind"::Normal, 300);
        SeedEntry(23, 8, "CG X050 Entry Kind"::Cancelled, 45);

        // [GIVEN] a decoy batch that BatchDigest(8) must never read from
        SeedEntry(80, 97, "CG X050 Entry Kind"::Normal, 500);
        SeedEntry(81, 97, "CG X050 Entry Kind"::Cancelled, 600);

        // [WHEN]
        Result := Teller.BatchDigest(8);

        // [THEN]
        Assert.AreEqual(12814, Result, 'Batch 8 digest must match its specification.');

        // [THEN] the decoy batch must be completely untouched
        Assert.IsTrue(Decoy.Get(80), 'Decoy entry 80 must still exist');
        Assert.AreEqual(500, Decoy.Amount, 'Decoy batch 97 entry 80 must be untouched');
        Assert.IsTrue(Decoy.Get(81), 'Decoy entry 81 must still exist');
        Assert.AreEqual(600, Decoy.Amount, 'Decoy batch 97 entry 81 must be untouched');

        // [THEN] BatchDigest must be read-only over the ledger
        Entry.Reset();
        Assert.AreEqual(6, Entry.Count(), 'BatchDigest must not alter the ledger.');

        ClearState();
    end;
}
