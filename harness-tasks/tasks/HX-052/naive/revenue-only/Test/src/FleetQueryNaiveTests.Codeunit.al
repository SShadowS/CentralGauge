codeunit 80106 "CGR Fleet Query Naive Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure RevenueIsGroupedByMonth()
    var
        Revenue: Query "CGR Revenue by Vehicle Month";
        Rows: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearLedgerEntries('HX052-N01');
        Lib.InsertLedgerEntry('HX052-N01', 20270310D, 100);
        Lib.InsertLedgerEntry('HX052-N01', 20270320D, 50.5);
        Lib.InsertLedgerEntry('HX052-N01', 20270402D, 70);

        Revenue.SetRange(VehicleNo, 'HX052-N01');
        Revenue.Open();
        while Revenue.Read() do begin
            Rows += 1;
            Assert.AreEqual(2027, Revenue.PostingYear, 'Posting year');
            case Revenue.PostingMonth of
                3:
                    begin
                        Assert.AreEqual(150.50, Revenue.Amount, 'March revenue');
                        Assert.AreEqual(2, Revenue.EntryCount, 'March entries');
                    end;
                4:
                    begin
                        Assert.AreEqual(70.00, Revenue.Amount, 'April revenue');
                        Assert.AreEqual(1, Revenue.EntryCount, 'April entries');
                    end;
                else
                    Assert.Fail(StrSubstNo('Unexpected month %1', Revenue.PostingMonth));
            end;
        end;
        Revenue.Close();
        Assert.AreEqual(2, Rows, 'One row per month');
    end;

    [Test]
    procedure RevenueVehiclesAreSeparateRows()
    var
        Revenue: Query "CGR Revenue by Vehicle Month";
        Rows: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearLedgerEntries('HX052-N02');
        Lib.ClearLedgerEntries('HX052-N03');
        Lib.InsertLedgerEntry('HX052-N02', 20270310D, 40);
        Lib.InsertLedgerEntry('HX052-N03', 20270311D, 60);

        Revenue.SetFilter(VehicleNo, '%1|%2', 'HX052-N02', 'HX052-N03');
        Revenue.Open();
        while Revenue.Read() do begin
            Rows += 1;
            case Revenue.VehicleNo of
                'HX052-N02':
                    Assert.AreEqual(40.00, Revenue.Amount, 'First vehicle revenue');
                'HX052-N03':
                    Assert.AreEqual(60.00, Revenue.Amount, 'Second vehicle revenue');
                else
                    Assert.Fail(StrSubstNo('Unexpected vehicle %1', Revenue.VehicleNo));
            end;
        end;
        Revenue.Close();
        Assert.AreEqual(2, Rows, 'One row per vehicle');
    end;

    [Test]
    procedure SameMonthInTwoYearsIsTwoRows()
    var
        Revenue: Query "CGR Revenue by Vehicle Month";
        Rows: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearLedgerEntries('HX052-N04');
        Lib.InsertLedgerEntry('HX052-N04', 20270310D, 80);
        Lib.InsertLedgerEntry('HX052-N04', 20280310D, 30);

        Revenue.SetRange(VehicleNo, 'HX052-N04');
        Revenue.Open();
        while Revenue.Read() do begin
            Rows += 1;
            Assert.AreEqual(3, Revenue.PostingMonth, 'Posting month');
            case Revenue.PostingYear of
                2027:
                    Assert.AreEqual(80, Revenue.Amount, 'March 2027 revenue');
                2028:
                    Assert.AreEqual(30, Revenue.Amount, 'March 2028 revenue');
                else
                    Assert.Fail(StrSubstNo('Unexpected year %1', Revenue.PostingYear));
            end;
        end;
        Revenue.Close();
        Assert.AreEqual(2, Rows, 'One row per year and month');
    end;

    [Test]
    procedure RefundAndZeroEntryInOneMonth()
    var
        Revenue: Query "CGR Revenue by Vehicle Month";
        Rows: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearLedgerEntries('HX052-N05');
        Lib.InsertLedgerEntry('HX052-N05', 20270310D, 100);
        Lib.InsertLedgerEntry('HX052-N05', 20270318D, -30);
        Lib.InsertLedgerEntry('HX052-N05', 20270325D, 0);

        Revenue.SetRange(VehicleNo, 'HX052-N05');
        Revenue.Open();
        while Revenue.Read() do begin
            Rows += 1;
            Assert.AreEqual(2027, Revenue.PostingYear, 'Posting year');
            Assert.AreEqual(3, Revenue.PostingMonth, 'Posting month');
            Assert.AreEqual(70, Revenue.Amount, 'The refund reduces the March revenue');
            Assert.AreEqual(3, Revenue.EntryCount, 'Refund and zero-amount entry are counted');
        end;
        Revenue.Close();
        Assert.AreEqual(1, Rows, 'One row for March');
    end;
}
