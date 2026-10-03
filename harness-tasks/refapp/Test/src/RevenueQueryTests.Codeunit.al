codeunit 80058 "CGR Revenue Query Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure RevenueGroupedByMonth()
    var
        Revenue: Query "CGR Revenue by Vehicle Month";
        Rows: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearLedgerEntries('T-REV-001');
        Lib.InsertLedgerEntry('T-REV-001', 20270310D, 100);
        Lib.InsertLedgerEntry('T-REV-001', 20270320D, 50.5);
        Lib.InsertLedgerEntry('T-REV-001', 20270402D, 70);

        Revenue.SetRange(VehicleNo, 'T-REV-001');
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
    procedure VehiclesAreSeparateRows()
    var
        Revenue: Query "CGR Revenue by Vehicle Month";
        Rows: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearLedgerEntries('T-REV-002');
        Lib.ClearLedgerEntries('T-REV-003');
        Lib.InsertLedgerEntry('T-REV-002', 20270310D, 40);
        Lib.InsertLedgerEntry('T-REV-003', 20270311D, 60);

        Revenue.SetFilter(VehicleNo, '%1|%2', 'T-REV-002', 'T-REV-003');
        Revenue.Open();
        while Revenue.Read() do begin
            Rows += 1;
            case Revenue.VehicleNo of
                'T-REV-002':
                    Assert.AreEqual(40.00, Revenue.Amount, 'First vehicle revenue');
                'T-REV-003':
                    Assert.AreEqual(60.00, Revenue.Amount, 'Second vehicle revenue');
                else
                    Assert.Fail(StrSubstNo('Unexpected vehicle %1', Revenue.VehicleNo));
            end;
        end;
        Revenue.Close();
        Assert.AreEqual(2, Rows, 'One row per vehicle');
    end;
}
