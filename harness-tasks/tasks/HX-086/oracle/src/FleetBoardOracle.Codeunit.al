// Every procedure deletes every CGR Vehicle first (the codeunit's isolation restores them), so a vehicle outside a
// procedure's own rows cannot reach a board. Vehicles carry non-default values in every field; board rows are
// compared with the stored vehicle field by field. The one call that may raise on a duplicate board row runs
// through the runner after Commit().
codeunit 87180 "HX086 Fleet Board Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure SnapshotCopiesFilteredVehicles()
    var
        VehicleFilter: Record "CGR Vehicle";
        Board: Record "CGR Vehicle" temporary;
        FleetBoard: Codeunit "CGR Fleet Board";
    begin
        HX86Prepare();
        HX86Vehicle('HX086-1A', 1, false, false, 0);
        HX86Vehicle('HX086-1B', 2, true, false, 1);
        HX86Vehicle('HX086-1C', 3, false, false, 0);

        VehicleFilter.SetFilter("No.", 'HX086-1A|HX086-1B');
        Assert.AreEqual(2, FleetBoard.TakeVehicleSnapshot(VehicleFilter, Board), 'TakeVehicleSnapshot returns the number of vehicles it copied');

        Board.Reset();
        Assert.AreEqual(2, Board.Count(), 'Board holds exactly the vehicles in the filter');
        HX86AssertOnBoard(Board, 'HX086-1A');
        HX86AssertOnBoard(Board, 'HX086-1B');
        Assert.IsFalse(Board.Get('HX086-1C'), 'A vehicle outside the filter is not copied');
    end;

    [Test]
    procedure ExistingRowRefreshed()
    var
        Vehicle: Record "CGR Vehicle";
        Row: Record "CGR Vehicle";
        Runner: Codeunit "HX086 Snapshot Runner";
        Ok: Boolean;
        RunError: Text;
    begin
        HX86Prepare();
        HX86Vehicle('HX086-2A', 4, false, false, 0);
        Row.Init();
        Row."No." := 'HX086-2A';
        Row.Mileage := 1;
        Row.Description := 'old';
        Runner.HX86AddBoardRow(Row);
        Assert.IsTrue(Runner.HX86GetBoardRow('HX086-2A', Row), 'Precondition: Board holds the vehicle');
        Assert.AreEqual(1, Row.Mileage, 'Precondition: the board row carries an old Mileage');
        Runner.HX86SetVehicleFilter('HX086-2A');

        Commit();
        Ok := Runner.Run();
        RunError := GetLastErrorText();

        Assert.IsTrue(Ok, 'A vehicle already on Board does not make TakeVehicleSnapshot fail: ' + RunError);
        Assert.AreEqual(1, Runner.HX86Taken(), 'A replaced vehicle counts as copied');
        Assert.AreEqual(1, Runner.HX86BoardCount(), 'The vehicle is on Board once');
        Assert.IsTrue(Runner.HX86GetBoardRow('HX086-2A', Row), 'The vehicle stays on Board');
        Vehicle.Get('HX086-2A');
        HX86AssertSame(Vehicle, Row, 'The board row is replaced by the vehicle''s current values');
    end;

    [Test]
    procedure OtherRowsKept()
    var
        VehicleFilter: Record "CGR Vehicle";
        Board: Record "CGR Vehicle" temporary;
        FleetBoard: Codeunit "CGR Fleet Board";
    begin
        HX86Prepare();
        HX86Vehicle('HX086-3A', 5, false, false, 0);
        HX86Vehicle('HX086-3B', 6, false, false, 0);
        HX86BoardRow(Board, 'HX086-3Z', 7, 'HX086 caller row');
        HX86BoardRow(Board, 'HX086-3B', 2, 'stale');

        VehicleFilter.SetRange("No.", 'HX086-3A');
        Assert.AreEqual(1, FleetBoard.TakeVehicleSnapshot(VehicleFilter, Board), 'Only the vehicle in the filter is counted');

        Board.Reset();
        Assert.AreEqual(3, Board.Count(), 'The caller''s rows stay and the vehicle is added');
        HX86AssertOnBoard(Board, 'HX086-3A');
        Assert.IsTrue(Board.Get('HX086-3Z'), 'A board row with no vehicle stays');
        Assert.AreEqual(7, Board.Mileage, 'A board row with no vehicle is unchanged (Mileage)');
        Assert.AreEqual('HX086 caller row', Board.Description, 'A board row with no vehicle is unchanged (Description)');
        Assert.IsTrue(Board.Get('HX086-3B'), 'A board row of a vehicle outside the filter stays');
        Assert.AreEqual(2, Board.Mileage, 'A board row of a vehicle outside the filter keeps its values (Mileage)');
        Assert.AreEqual('stale', Board.Description, 'A board row of a vehicle outside the filter keeps its values (Description)');
    end;

    [Test]
    procedure BoardFiltersKept()
    var
        Vehicle: Record "CGR Vehicle";
        VehicleFilter: Record "CGR Vehicle";
        Board: Record "CGR Vehicle" temporary;
        FleetBoard: Codeunit "CGR Fleet Board";
        FiltersBefore: Text;
    begin
        HX86Prepare();
        HX86Vehicle('HX086-4A', 7, false, false, 0);
        Vehicle.Get('HX086-4A');
        Assert.IsTrue(Vehicle.Mileage > 10, 'Precondition: the vehicle lies outside the board''s Mileage filter');
        Board.SetRange(Mileage, 0, 10);
        FiltersBefore := Board.GetFilters();
        Assert.AreNotEqual('', FiltersBefore, 'Precondition: Board carries the caller''s filter');

        VehicleFilter.SetRange("No.", 'HX086-4A');
        Assert.AreEqual(1, FleetBoard.TakeVehicleSnapshot(VehicleFilter, Board), 'The board''s filter does not limit what is copied');

        Assert.AreEqual(FiltersBefore, Board.GetFilters(), 'The caller''s filters on Board are unchanged');
        Board.Reset();
        HX86AssertOnBoard(Board, 'HX086-4A');
    end;

    [Test]
    procedure VehicleFilterUnchanged()
    var
        VehicleFilter: Record "CGR Vehicle";
        Board: Record "CGR Vehicle" temporary;
        FleetBoard: Codeunit "CGR Fleet Board";
        FiltersBefore: Text;
    begin
        HX86Prepare();
        HX86Vehicle('HX086-5A', 8, false, false, 0);
        HX86Vehicle('HX086-5B', 9, false, true, 0);
        HX86Vehicle('HX086-0X', 10, false, false, 0);

        VehicleFilter.SetRange(Blocked, false);
        VehicleFilter.SetFilter("No.", 'HX086-5*');
        FiltersBefore := VehicleFilter.GetFilters();
        Assert.AreEqual(1, FleetBoard.TakeVehicleSnapshot(VehicleFilter, Board), 'Every filter on VehicleFilter applies');

        Assert.AreEqual(FiltersBefore, VehicleFilter.GetFilters(), 'The filters on VehicleFilter are unchanged');
        Board.Reset();
        Assert.AreEqual(1, Board.Count(), 'Board holds only the vehicle within both filters');
        HX86AssertOnBoard(Board, 'HX086-5A');
    end;

    [Test]
    procedure SnapshotKeepsTakenValues()
    var
        Vehicle: Record "CGR Vehicle";
        VehicleFilter: Record "CGR Vehicle";
        Board: Record "CGR Vehicle" temporary;
        FleetBoard: Codeunit "CGR Fleet Board";
        TakenMileage: Integer;
        TakenDescription: Text[100];
    begin
        HX86Prepare();
        HX86Vehicle('HX086-6A', 11, false, false, 0);
        Vehicle.Get('HX086-6A');
        TakenMileage := Vehicle.Mileage;
        TakenDescription := Vehicle.Description;

        VehicleFilter.SetRange("No.", 'HX086-6A');
        Assert.AreEqual(1, FleetBoard.TakeVehicleSnapshot(VehicleFilter, Board), 'The vehicle is copied');
        Vehicle.Get('HX086-6A');
        Vehicle.Mileage := 9999;
        Vehicle.Description := 'HX086 changed later';
        Vehicle.Modify();
        Vehicle.Get('HX086-6A');
        Assert.AreEqual(9999, Vehicle.Mileage, 'Precondition: the vehicle changed after the snapshot');

        Board.Reset();
        Assert.IsTrue(Board.Get('HX086-6A'), 'The vehicle is on Board');
        Assert.AreEqual(TakenMileage, Board.Mileage, 'The snapshot keeps the Mileage it was taken with');
        Assert.AreEqual(TakenDescription, Board.Description, 'The snapshot keeps the Description it was taken with');
    end;

    [Test]
    procedure NothingInFilter()
    var
        Vehicle: Record "CGR Vehicle";
        VehicleFilter: Record "CGR Vehicle";
        Board: Record "CGR Vehicle" temporary;
        FleetBoard: Codeunit "CGR Fleet Board";
    begin
        HX86Prepare();
        HX86Vehicle('HX086-7A', 12, false, false, 0);
        Assert.IsFalse(Vehicle.Get('HX086-NONE'), 'Precondition: no vehicle HX086-NONE');
        HX86BoardRow(Board, 'HX086-7Z', 7, 'HX086 caller row');

        VehicleFilter.SetRange("No.", 'HX086-NONE');
        Assert.AreEqual(0, FleetBoard.TakeVehicleSnapshot(VehicleFilter, Board), 'No vehicle in the filter: nothing copied');

        Board.Reset();
        Assert.AreEqual(1, Board.Count(), 'Board holds only the caller''s row');
        Assert.IsTrue(Board.Get('HX086-7Z'), 'The caller''s row stays');
        Assert.AreEqual('HX086 caller row', Board.Description, 'The caller''s row is unchanged');
    end;

    [Test]
    procedure FreeVehiclesAsToday()
    var
        Board: Record "CGR Vehicle" temporary;
        FleetBoard: Codeunit "CGR Fleet Board";
    begin
        HX86Prepare();
        HX86Vehicle('HX086-8A', 13, false, false, 0);
        HX86Vehicle('HX086-8B', 14, true, false, 0);
        HX86Vehicle('HX086-8C', 15, false, true, 1);
        HX86Vehicle('HX086-8D', 16, true, true, 0);
        HX86BoardRow(Board, 'HX086-8X', 7, 'HX086 caller row');

        Assert.AreEqual(1, FleetBoard.SnapshotFreeVehicles(Board), 'SnapshotFreeVehicles returns the number of free vehicles');

        Board.Reset();
        Assert.AreEqual(1, Board.Count(), 'Board holds exactly the free vehicles');
        HX86AssertOnBoard(Board, 'HX086-8A');
        Assert.IsFalse(Board.Get('HX086-8X'), 'SnapshotFreeVehicles empties the board first, as today');
    end;

    [Test]
    procedure DamagedVehiclesAsToday()
    var
        Board: Record "CGR Vehicle" temporary;
        FleetBoard: Codeunit "CGR Fleet Board";
    begin
        HX86Prepare();
        HX86Vehicle('HX086-9D', 17, false, false, 2);
        HX86Vehicle('HX086-9E', 18, false, false, 0);
        HX86Vehicle('HX086-9F', 19, true, true, 1);
        HX86BoardRow(Board, 'HX086-9X', 7, 'HX086 caller row');

        Assert.AreEqual(2, FleetBoard.SnapshotDamagedVehicles(Board), 'SnapshotDamagedVehicles returns the number of damaged vehicles');

        Board.Reset();
        Assert.AreEqual(2, Board.Count(), 'Board holds exactly the damaged vehicles');
        HX86AssertOnBoard(Board, 'HX086-9D');
        HX86AssertOnBoard(Board, 'HX086-9F');
        Assert.IsFalse(Board.Get('HX086-9X'), 'SnapshotDamagedVehicles empties the board first, as today');
    end;

    local procedure HX86AssertOnBoard(var Board: Record "CGR Vehicle" temporary; VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Assert.IsTrue(Board.Get(VehicleNo), StrSubstNo('Vehicle %1 is on Board', VehicleNo));
        Vehicle.Get(VehicleNo);
        HX86AssertSame(Vehicle, Board, StrSubstNo('Board row of %1', VehicleNo));
    end;

    local procedure HX86AssertSame(Expected: Record "CGR Vehicle"; Actual: Record "CGR Vehicle"; Context: Text)
    begin
        Assert.AreEqual(Expected."No.", Actual."No.", Context + ': No.');
        Assert.AreEqual(Expected.Mileage, Actual.Mileage, Context + ': Mileage');
        Assert.AreEqual(Expected."Checked Out", Actual."Checked Out", Context + ': Checked Out');
        Assert.AreEqual(Expected.Strategy, Actual.Strategy, Context + ': Strategy');
        Assert.AreEqual(Expected.Blocked, Actual.Blocked, Context + ': Blocked');
        Assert.AreEqual(Expected."Last Service Km", Actual."Last Service Km", Context + ': Last Service Km');
        Assert.AreEqual(Expected."Daily Rate", Actual."Daily Rate", Context + ': Daily Rate');
        Assert.AreEqual(Expected.Description, Actual.Description, Context + ': Description');
        Assert.AreEqual(Expected."Open Damages", Actual."Open Damages", Context + ': Open Damages');
        Assert.AreEqual(Expected."Service Plan Code", Actual."Service Plan Code", Context + ': Service Plan Code');
        Assert.AreEqual(Expected."Last Service Date", Actual."Last Service Date", Context + ': Last Service Date');
    end;

    local procedure HX86Vehicle(VehicleNo: Code[20]; Seed: Integer; CheckedOut: Boolean; IsBlocked: Boolean; OpenDamages: Integer)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 5000 + Seed;
        Vehicle."Checked Out" := CheckedOut;
        Vehicle.Strategy := Enum::"CGR Maintenance Strategy"::"Heavy Duty";
        Vehicle.Blocked := IsBlocked;
        Vehicle."Last Service Km" := 4000 + Seed;
        Vehicle."Daily Rate" := 49.5 + Seed;
        Vehicle.Description := 'HX086 vehicle ' + VehicleNo;
        Vehicle."Open Damages" := OpenDamages;
        Vehicle."Service Plan Code" := 'HX086-SP';
        Vehicle."Last Service Date" := 20270115D + Seed;
        Vehicle.Insert();
    end;

    local procedure HX86BoardRow(var Board: Record "CGR Vehicle" temporary; VehicleNo: Code[20]; Mileage: Integer; RowDescription: Text[100])
    begin
        Board.Init();
        Board."No." := VehicleNo;
        Board.Mileage := Mileage;
        Board.Description := RowDescription;
        Board.Insert();
    end;

    local procedure HX86Prepare()
    var
        Setup: Record "CGR Setup";
        Vehicle: Record "CGR Vehicle";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Weekend Surcharge %" := 0;
        Setup."Km Allowance per Day" := 1000;
        Setup."Excess Km Rate" := 0;
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup."Outbox Max Attempts" := 3;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
        Vehicle.Reset();
        Vehicle.DeleteAll();
    end;
}
