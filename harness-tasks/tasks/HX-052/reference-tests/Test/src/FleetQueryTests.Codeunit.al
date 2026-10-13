codeunit 80105 "CGR Fleet Query Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure RefundReducesMonthlyRevenue()
    var
        Revenue: Query "CGR Revenue by Vehicle Month";
        Rows: Integer;
    begin
        SetUpQueries();
        Lib.ClearLedgerEntries('HX052-R01');
        Lib.InsertLedgerEntry('HX052-R01', 20270310D, 100);
        Lib.InsertLedgerEntry('HX052-R01', 20270320D, -30);
        Lib.InsertLedgerEntry('HX052-R01', 20270405D, -20);

        Revenue.SetRange(VehicleNo, 'HX052-R01');
        Revenue.Open();
        while Revenue.Read() do begin
            Rows += 1;
            Assert.AreEqual(2027, Revenue.PostingYear, 'Posting year');
            case Revenue.PostingMonth of
                3:
                    begin
                        Assert.AreEqual(70, Revenue.Amount, 'A refund reduces the March revenue');
                        Assert.AreEqual(2, Revenue.EntryCount, 'The refund is counted in March');
                    end;
                4:
                    begin
                        Assert.AreEqual(-20, Revenue.Amount, 'A month with only a refund has negative revenue');
                        Assert.AreEqual(1, Revenue.EntryCount, 'April has the refund only');
                    end;
                else
                    Assert.Fail(StrSubstNo('Unexpected month %1', Revenue.PostingMonth));
            end;
        end;
        Revenue.Close();
        Assert.AreEqual(2, Rows, 'One row per month, the refund-only month included');
    end;

    [Test]
    procedure ZeroAmountEntryIsCounted()
    var
        Revenue: Query "CGR Revenue by Vehicle Month";
        Rows: Integer;
    begin
        SetUpQueries();
        Lib.ClearLedgerEntries('HX052-R02');
        Lib.InsertLedgerEntry('HX052-R02', 20270310D, 100);
        Lib.InsertLedgerEntry('HX052-R02', 20270315D, 0);
        Lib.InsertLedgerEntry('HX052-R02', 20270502D, 0);

        Revenue.SetRange(VehicleNo, 'HX052-R02');
        Revenue.Open();
        while Revenue.Read() do begin
            Rows += 1;
            Assert.AreEqual(2027, Revenue.PostingYear, 'Posting year');
            case Revenue.PostingMonth of
                3:
                    begin
                        Assert.AreEqual(100, Revenue.Amount, 'March revenue');
                        Assert.AreEqual(2, Revenue.EntryCount, 'The zero-amount entry is counted in March');
                    end;
                5:
                    begin
                        Assert.AreEqual(0, Revenue.Amount, 'May revenue');
                        Assert.AreEqual(1, Revenue.EntryCount, 'May has the zero-amount entry only');
                    end;
                else
                    Assert.Fail(StrSubstNo('Unexpected month %1', Revenue.PostingMonth));
            end;
        end;
        Revenue.Close();
        Assert.AreEqual(2, Rows, 'One row per month, the zero-only month included');
    end;

    [Test]
    procedure RevenueSeparatesYearsAndVehicles()
    var
        Revenue: Query "CGR Revenue by Vehicle Month";
        Seen2027: Boolean;
        Seen2028: Boolean;
        SeenOther: Boolean;
        Rows: Integer;
    begin
        SetUpQueries();
        Lib.ClearLedgerEntries('HX052-R03');
        Lib.ClearLedgerEntries('HX052-R04');
        Lib.InsertLedgerEntry('HX052-R03', 20270310D, 40);
        Lib.InsertLedgerEntry('HX052-R03', 20280310D, 25);
        Lib.InsertLedgerEntry('HX052-R04', 20270311D, 60);

        Revenue.SetFilter(VehicleNo, '%1|%2', 'HX052-R03', 'HX052-R04');
        Revenue.Open();
        while Revenue.Read() do begin
            Rows += 1;
            Assert.AreEqual(3, Revenue.PostingMonth, 'Posting month');
            Assert.AreEqual(1, Revenue.EntryCount, 'One entry per row');
            case true of
                (Revenue.VehicleNo = 'HX052-R03') and (Revenue.PostingYear = 2027):
                    begin
                        Seen2027 := true;
                        Assert.AreEqual(40, Revenue.Amount, 'March 2027 revenue of the first vehicle');
                    end;
                (Revenue.VehicleNo = 'HX052-R03') and (Revenue.PostingYear = 2028):
                    begin
                        Seen2028 := true;
                        Assert.AreEqual(25, Revenue.Amount, 'March 2028 revenue of the first vehicle');
                    end;
                (Revenue.VehicleNo = 'HX052-R04') and (Revenue.PostingYear = 2027):
                    begin
                        SeenOther := true;
                        Assert.AreEqual(60, Revenue.Amount, 'March 2027 revenue of the second vehicle');
                    end;
                else
                    Assert.Fail(StrSubstNo('Unexpected row %1 %2', Revenue.VehicleNo, Revenue.PostingYear));
            end;
        end;
        Revenue.Close();
        Assert.AreEqual(3, Rows, 'One row per vehicle, year and month');
        Assert.IsTrue(Seen2027 and Seen2028 and SeenOther, 'Every vehicle, year and month has its row');
    end;

    [Test]
    procedure StatusListsBlockedFreeVehicle()
    var
        Status: Query "CGR Vehicle Status";
        Rows: Integer;
    begin
        SetUpQueries();
        CreateStatusVehicle('HX052-S01', 2500, 2000, true, false);

        Status.SetRange(VehicleNo, 'HX052-S01');
        Status.Open();
        while Status.Read() do begin
            Rows += 1;
            Assert.AreEqual('HX052-S01', Status.VehicleNo, 'Vehicle number');
            Assert.IsFalse(Status.CheckedOut, 'A blocked vehicle at the yard is not checked out');
            Assert.AreEqual(2500, Status.Mileage, 'Mileage is the vehicle''s current mileage');
        end;
        Status.Close();
        Assert.AreEqual(1, Rows, 'A blocked vehicle has its row');
    end;

    [Test]
    procedure StatusListsCheckedOutVehicle()
    var
        Status: Query "CGR Vehicle Status";
        Rows: Integer;
    begin
        SetUpQueries();
        CreateStatusVehicle('HX052-S02', 3500, 3000, false, true);

        Status.SetRange(VehicleNo, 'HX052-S02');
        Status.Open();
        while Status.Read() do begin
            Rows += 1;
            Assert.AreEqual('HX052-S02', Status.VehicleNo, 'Vehicle number');
            Assert.IsTrue(Status.CheckedOut, 'A vehicle out on rent is checked out');
            Assert.AreEqual(3500, Status.Mileage, 'Mileage is the vehicle''s current mileage');
        end;
        Status.Close();
        Assert.AreEqual(1, Rows, 'A checked-out vehicle has its row');
    end;

    [Test]
    procedure StatusHasOneRowPerVehicle()
    var
        Status: Query "CGR Vehicle Status";
        SeenFree: Boolean;
        SeenOut: Boolean;
        Rows: Integer;
    begin
        SetUpQueries();
        CreateStatusVehicle('HX052-S03', 1200, 1000, false, false);
        CreateStatusVehicle('HX052-S04', 4200, 4000, true, true);

        Status.SetFilter(VehicleNo, '%1|%2', 'HX052-S03', 'HX052-S04');
        Status.Open();
        while Status.Read() do begin
            Rows += 1;
            case Status.VehicleNo of
                'HX052-S03':
                    begin
                        SeenFree := true;
                        Assert.IsFalse(Status.CheckedOut, 'Free vehicle is not checked out');
                        Assert.AreEqual(1200, Status.Mileage, 'Free vehicle mileage');
                    end;
                'HX052-S04':
                    begin
                        SeenOut := true;
                        Assert.IsTrue(Status.CheckedOut, 'Blocked vehicle out on rent is checked out');
                        Assert.AreEqual(4200, Status.Mileage, 'Blocked vehicle mileage');
                    end;
                else
                    Assert.Fail(StrSubstNo('Unexpected vehicle %1', Status.VehicleNo));
            end;
        end;
        Status.Close();
        Assert.AreEqual(2, Rows, 'One row per vehicle');
        Assert.IsTrue(SeenFree and SeenOut, 'Both vehicles have their row');
    end;

    local procedure SetUpQueries()
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
    end;

    local procedure CreateStatusVehicle(VehicleNo: Code[20]; Mileage: Integer; LastServiceKm: Integer; IsBlocked: Boolean; IsCheckedOut: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Lib.CreateVehicle(VehicleNo, Mileage, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetLastServiceKm(VehicleNo, LastServiceKm);
        Vehicle.Get(VehicleNo);
        Vehicle.Blocked := IsBlocked;
        Vehicle."Checked Out" := IsCheckedOut;
        Vehicle.Modify();
    end;
}
