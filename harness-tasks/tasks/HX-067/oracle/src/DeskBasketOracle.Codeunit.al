// Every procedure empties the basket left by an earlier procedure before it starts and empties its own afterwards
// (a session-wide basket outlives a procedure). Rows that check out or may raise run through the runner after Commit().
codeunit 86800 "HX067 Desk Basket Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure BasketSharedAcrossVariables()
    var
        Basket1: Codeunit "CGR Desk Basket";
    begin
        HX67Prepare();
        HX67Vehicle('HX067-1A');
        HX67Vehicle('HX067-1B');

        Basket1.AddToBasket('HX067-1A');
        Basket1.AddToBasket('HX067-1B');

        HX67AssertBasket(2, 'HX067-1A', 'HX067-1B', 'Another variable sees the basket');
        HX67Finish();
    end;

    [Test]
    procedure AddTwiceKeepsOne()
    var
        DeskBasket: Codeunit "CGR Desk Basket";
    begin
        HX67Prepare();
        HX67Vehicle('HX067-2A');
        HX67Vehicle('HX067-2B');

        DeskBasket.AddToBasket('HX067-2A');
        DeskBasket.AddToBasket('HX067-2A');
        DeskBasket.AddToBasket('HX067-2B');

        HX67AssertBasket(2, 'HX067-2A', 'HX067-2B', 'A vehicle added twice is in the basket once');
        HX67Finish();
    end;

    [Test]
    procedure RemovedVehicleLeaves()
    var
        DeskBasket: Codeunit "CGR Desk Basket";
    begin
        HX67Prepare();
        HX67Vehicle('HX067-3A');
        HX67Vehicle('HX067-3B');
        HX67Vehicle('HX067-3C');

        DeskBasket.AddToBasket('HX067-3A');
        DeskBasket.AddToBasket('HX067-3B');
        DeskBasket.RemoveFromBasket('HX067-3A');
        DeskBasket.RemoveFromBasket('HX067-3C');

        HX67AssertBasket(1, 'HX067-3B', '', 'Only the vehicle not removed stays');
        HX67Finish();
    end;

    [Test]
    procedure CallerBufferReplaced()
    var
        BasketVehicle: Record "CGR Vehicle" temporary;
        DeskBasket: Codeunit "CGR Desk Basket";
    begin
        HX67Prepare();
        HX67Vehicle('HX067-4A');
        BasketVehicle.Init();
        BasketVehicle."No." := 'HX067-4X';
        BasketVehicle.Insert();
        BasketVehicle.SetRange("No.", 'HX067-4X');

        DeskBasket.AddToBasket('HX067-4A');
        DeskBasket.GetBasket(BasketVehicle);

        BasketVehicle.Reset();
        Assert.AreEqual(1, BasketVehicle.Count(), 'The caller''s buffer holds only the basket');
        BasketVehicle.FindFirst();
        Assert.AreEqual('HX067-4A', BasketVehicle."No.", 'The caller''s earlier row is gone');
        HX67Finish();
    end;

    [Test]
    procedure HandedOutRowsAreCopies()
    var
        Vehicle: Record "CGR Vehicle";
        FirstVehicle: Record "CGR Vehicle" temporary;
        SecondVehicle: Record "CGR Vehicle" temporary;
        DeskBasket: Codeunit "CGR Desk Basket";
    begin
        HX67Prepare();
        HX67Vehicle('HX067-5A');
        HX67Vehicle('HX067-5B');

        DeskBasket.AddToBasket('HX067-5A');
        DeskBasket.AddToBasket('HX067-5B');
        DeskBasket.GetBasket(FirstVehicle);
        Assert.AreEqual(2, FirstVehicle.Count(), 'Precondition: both vehicles are handed out');
        FirstVehicle.DeleteAll();

        DeskBasket.GetBasket(SecondVehicle);
        Assert.AreEqual(2, SecondVehicle.Count(), 'Deleting the handed-out rows does not change the basket');
        Assert.IsTrue(Vehicle.Get('HX067-5A'), 'Vehicle A is still in the fleet');
        Assert.IsTrue(Vehicle.Get('HX067-5B'), 'Vehicle B is still in the fleet');
        HX67Finish();
    end;

    [Test]
    procedure HandedOutShowsCurrentData()
    var
        Vehicle: Record "CGR Vehicle";
        BasketVehicle: Record "CGR Vehicle" temporary;
        DeskBasket: Codeunit "CGR Desk Basket";
    begin
        HX67Prepare();
        HX67Vehicle('HX067-6A');

        DeskBasket.AddToBasket('HX067-6A');
        Vehicle.Get('HX067-6A');
        Vehicle.Mileage := 1500;
        Vehicle."Daily Rate" := 70;
        Vehicle.Description := 'HX067 changed';
        Vehicle."Last Service Km" := 900;
        Vehicle."Last Service Date" := 20270201D;
        Vehicle.Modify();
        DeskBasket.GetBasket(BasketVehicle);

        Assert.AreEqual(1, BasketVehicle.Count(), 'One vehicle is handed out');
        BasketVehicle.FindFirst();
        Vehicle.Get('HX067-6A');
        Assert.AreEqual('HX067-6A', BasketVehicle."No.", 'Handed-out vehicle');
        Assert.AreEqual(1500, BasketVehicle.Mileage, 'Mileage as stored now');
        Assert.AreEqual(70, BasketVehicle."Daily Rate", 'Daily Rate as stored now');
        Assert.IsFalse(BasketVehicle.Blocked, 'Blocked as stored now');
        Assert.AreEqual(Vehicle.Description, BasketVehicle.Description, 'Description as stored now');
        Assert.AreEqual(Vehicle."Last Service Km", BasketVehicle."Last Service Km", 'Last Service Km as stored now');
        Assert.AreEqual(Vehicle."Last Service Date", BasketVehicle."Last Service Date", 'Last Service Date as stored now');
        Assert.AreEqual(Vehicle."Checked Out", BasketVehicle."Checked Out", 'Checked Out as stored now');
        Assert.AreEqual(Vehicle.Strategy, BasketVehicle.Strategy, 'Strategy as stored now');
        Assert.AreEqual(Vehicle."Open Damages", BasketVehicle."Open Damages", 'Open Damages as stored now');
        Assert.AreEqual(Vehicle."Service Plan Code", BasketVehicle."Service Plan Code", 'Service Plan Code as stored now');
        HX67Finish();
    end;

    [Test]
    procedure CheckOutBasketChecksOutAll()
    var
        Runner: Codeunit "HX067 Basket Runner";
        Ok: Boolean;
    begin
        HX67Prepare();
        HX67Vehicle('HX067-7A');
        HX67Vehicle('HX067-7B');
        HX67Vehicle('HX067-7C');

        HX67Add('HX067-7A');
        HX67Add('HX067-7B');
        HX67Add('HX067-7C');
        Ok := HX67RunCheckOut(Runner, 'HX067 Customer', 20270305D, 20270307D);

        Assert.IsTrue(Ok, 'Checking out the basket succeeds: ' + GetLastErrorText());
        Assert.AreEqual(3, Runner.HX67CheckedOutCount(), 'Number checked out');
        HX67AssertCheckedOut('HX067-7A', 'HX067 Customer', 20270305D, 20270307D);
        HX67AssertCheckedOut('HX067-7B', 'HX067 Customer', 20270305D, 20270307D);
        HX67AssertCheckedOut('HX067-7C', 'HX067 Customer', 20270305D, 20270307D);
        HX67AssertBasket(0, '', '', 'The basket is empty after the checkout');
        HX67Finish();
    end;

    [Test]
    procedure UnavailableVehicleFailsAll()
    var
        Runner: Codeunit "HX067 Basket Runner";
        Ok: Boolean;
    begin
        HX67Prepare();
        HX67Vehicle('HX067-8A');
        HX67Vehicle('HX067-8B');

        HX67Add('HX067-8A');
        HX67Add('HX067-8B');
        HX67Block('HX067-8B', true);
        Ok := HX67RunCheckOut(Runner, 'HX067 Customer', 20270305D, 20270307D);

        Assert.IsFalse(Ok, 'Checking out a basket with an unavailable vehicle fails');
        Assert.AreEqual('Vehicle HX067-8B is not available.', GetLastErrorText(), 'The availability error reaches the caller');
        HX67AssertUntouched('HX067-8A');
        HX67AssertUntouched('HX067-8B');
        HX67AssertBasket(2, 'HX067-8A', 'HX067-8B', 'The basket stays after the failed checkout');
        HX67Finish();
    end;

    [Test]
    procedure RefusedCheckoutFailsAll()
    var
        Refusal: Codeunit "HX067 Checkout Refusal";
        Runner: Codeunit "HX067 Basket Runner";
        Ok: Boolean;
    begin
        HX67Prepare();
        HX67Vehicle('HX067-9A');
        HX67Vehicle('HX067-9B');

        HX67Add('HX067-9A');
        HX67Add('HX067-9B');
        Refusal.SetRefusedVehicle('HX067-9B');
        BindSubscription(Refusal);
        Ok := HX67RunCheckOut(Runner, 'HX067 Customer', 20270305D, 20270307D);
        UnbindSubscription(Refusal);

        Assert.IsFalse(Ok, 'A refused checkout fails the basket checkout');
        Assert.AreEqual('HX067 checkout refused for HX067-9B.', GetLastErrorText(), 'The refusal reaches the caller');
        HX67AssertUntouched('HX067-9A');
        HX67AssertUntouched('HX067-9B');
        HX67AssertBasket(2, 'HX067-9A', 'HX067-9B', 'The basket stays after the refused checkout');
        HX67Finish();
    end;

    [Test]
    procedure RetryAfterFailure()
    var
        Runner: Codeunit "HX067 Basket Runner";
        Ok: Boolean;
    begin
        HX67Prepare();
        HX67Vehicle('HX067-10A');
        HX67Vehicle('HX067-10B');

        HX67Add('HX067-10A');
        HX67Add('HX067-10B');
        HX67Block('HX067-10B', true);
        Ok := HX67RunCheckOut(Runner, 'HX067 Customer', 20270305D, 20270307D);
        Assert.IsFalse(Ok, 'Precondition: the first checkout fails');

        HX67Block('HX067-10B', false);
        Ok := HX67RunCheckOut(Runner, 'HX067 Other', 20270401D, 20270410D);

        Assert.IsTrue(Ok, 'The retried checkout succeeds: ' + GetLastErrorText());
        Assert.AreEqual(2, Runner.HX67CheckedOutCount(), 'Number checked out on the retry');
        HX67AssertCheckedOut('HX067-10A', 'HX067 Other', 20270401D, 20270410D);
        HX67AssertCheckedOut('HX067-10B', 'HX067 Other', 20270401D, 20270410D);
        HX67AssertBasket(0, '', '', 'The basket is empty after the retry');
        HX67Finish();
    end;

    [Test]
    procedure UnknownVehicleNotAdded()
    var
        DeskBasket: Codeunit "CGR Desk Basket";
        Runner: Codeunit "HX067 Basket Runner";
        Ok: Boolean;
    begin
        HX67Prepare();
        HX67Delete('HX067-NONE');
        HX67Vehicle('HX067-11A');

        DeskBasket.AddToBasket('HX067-11A');
        Commit();
        Runner.SetAdd('HX067-NONE');
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'Adding an unknown vehicle fails');
        Assert.AreEqual('The CGR Vehicle does not exist. Identification fields and values: No.=''HX067-NONE''', GetLastErrorText(), 'The not-found error reaches the caller');
        HX67AssertBasket(1, 'HX067-11A', '', 'The basket is as it was');
        HX67Finish();
    end;

    [Test]
    procedure EmptyBasketCheckout()
    var
        Vehicle: Record "CGR Vehicle";
        Runner: Codeunit "HX067 Basket Runner";
        Ok: Boolean;
    begin
        HX67Prepare();
        HX67Vehicle('HX067-12A');

        Ok := HX67RunCheckOut(Runner, 'HX067 Customer', 20270305D, 20270307D);

        Assert.IsTrue(Ok, 'Checking out an empty basket succeeds: ' + GetLastErrorText());
        Assert.AreEqual(0, Runner.HX67CheckedOutCount(), 'Nothing is checked out');
        Assert.AreEqual(0, HX67ContractCount('HX067-12A'), 'No contract for a vehicle not in the basket');
        Vehicle.Get('HX067-12A');
        Assert.IsFalse(Vehicle."Checked Out", 'A vehicle not in the basket is not checked out');
        HX67Finish();
    end;

    [Test]
    procedure EmptyBasketDropsAll()
    var
        DeskBasket: Codeunit "CGR Desk Basket";
    begin
        HX67Prepare();
        HX67Vehicle('HX067-13A');
        HX67Vehicle('HX067-13B');

        DeskBasket.AddToBasket('HX067-13A');
        DeskBasket.AddToBasket('HX067-13B');
        HX67AssertBasket(2, 'HX067-13A', 'HX067-13B', 'Precondition: both vehicles are in the basket');
        DeskBasket.EmptyBasket();

        HX67AssertBasket(0, '', '', 'EmptyBasket drops every vehicle');
        HX67Finish();
    end;

    local procedure HX67Add(VehicleNo: Code[20])
    var
        DeskBasket: Codeunit "CGR Desk Basket";
    begin
        DeskBasket.AddToBasket(VehicleNo);
    end;

    local procedure HX67RunCheckOut(var Runner: Codeunit "HX067 Basket Runner"; CustomerName: Text[100]; StartDate: Date; EndDate: Date): Boolean
    begin
        Commit();
        Runner.SetCheckOut(CustomerName, StartDate, EndDate);
        exit(Runner.Run());
    end;

    local procedure HX67AssertBasket(ExpectedCount: Integer; VehicleNo1: Code[20]; VehicleNo2: Code[20]; Msg: Text)
    var
        BasketVehicle: Record "CGR Vehicle" temporary;
        DeskBasket: Codeunit "CGR Desk Basket";
    begin
        DeskBasket.GetBasket(BasketVehicle);
        BasketVehicle.Reset();
        Assert.AreEqual(ExpectedCount, BasketVehicle.Count(), Msg + ': vehicle count');
        if VehicleNo1 <> '' then
            Assert.IsTrue(BasketVehicle.Get(VehicleNo1), Msg + ': ' + VehicleNo1 + ' is in the basket');
        if VehicleNo2 <> '' then
            Assert.IsTrue(BasketVehicle.Get(VehicleNo2), Msg + ': ' + VehicleNo2 + ' is in the basket');
    end;

    local procedure HX67AssertCheckedOut(VehicleNo: Code[20]; CustomerName: Text[100]; StartDate: Date; EndDate: Date)
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
    begin
        Contract.SetRange("Vehicle No.", VehicleNo);
        Assert.AreEqual(1, Contract.Count(), 'One contract for ' + VehicleNo);
        Contract.FindFirst();
        Assert.AreEqual(CustomerName, Contract."Customer Name", 'Customer of ' + VehicleNo);
        Assert.AreEqual(StartDate, Contract."Start Date", 'Start Date of ' + VehicleNo);
        Assert.AreEqual(EndDate, Contract."End Date", 'End Date of ' + VehicleNo);
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'Status of the contract of ' + VehicleNo);
        Assert.AreEqual(1000, Contract."Start Km", 'Start Km of ' + VehicleNo);
        Vehicle.Get(VehicleNo);
        Assert.IsTrue(Vehicle."Checked Out", VehicleNo + ' is checked out');
        Assert.AreEqual(1, HX67OutboxCount(VehicleNo), 'One outbox entry for ' + VehicleNo);
    end;

    local procedure HX67AssertUntouched(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Assert.AreEqual(0, HX67ContractCount(VehicleNo), 'No contract is kept for ' + VehicleNo);
        Vehicle.Get(VehicleNo);
        Assert.IsFalse(Vehicle."Checked Out", VehicleNo + ' is not checked out');
        Assert.AreEqual(0, HX67OutboxCount(VehicleNo), 'No outbox entry is kept for ' + VehicleNo);
    end;

    local procedure HX67ContractCount(VehicleNo: Code[20]): Integer
    var
        Contract: Record "CGR Rental Contract";
    begin
        Contract.SetRange("Vehicle No.", VehicleNo);
        exit(Contract.Count());
    end;

    local procedure HX67OutboxCount(VehicleNo: Code[20]): Integer
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.SetRange("Event Type", 'vehicleCheckedOut');
        exit(Entry.Count());
    end;

    local procedure HX67Block(VehicleNo: Code[20]; IsBlocked: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        Vehicle.Blocked := IsBlocked;
        if IsBlocked then
            Vehicle."Open Damages" := 1
        else
            Vehicle."Open Damages" := 0;
        Vehicle.Modify();
    end;

    local procedure HX67Delete(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Contract: Record "CGR Rental Contract";
        Entry: Record "CGR Outbox Entry";
    begin
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
    end;

    local procedure HX67Vehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
    begin
        HX67Delete(VehicleNo);
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle.Strategy := Enum::"CGR Maintenance Strategy"::Default;
        Vehicle."Daily Rate" := 50;
        Vehicle.Insert();
    end;

    local procedure HX67EmptyAll()
    var
        DeskBasket: Codeunit "CGR Desk Basket";
    begin
        DeskBasket.EmptyBasket();
    end;

    local procedure HX67Finish()
    begin
        HX67EmptyAll();
    end;

    local procedure HX67Prepare()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        HX67EmptyAll();
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
    end;
}
