codeunit 80473 "CGR Return Desk Exists Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        ExistsText: Text;

    [Test]
    procedure HeadlessExcessReturnIsCharged()
    var
        Charge: Record "CGR Return Excess Charge";
        Runner: Codeunit "CGR Return Desk Exists Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        ExistsPrepare();
        ContractNo := ExistsContract('HX139-NE1');
        Runner.SetExistsRun(ContractNo, 1450);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Return booked: ' + GetLastErrorText());
        Charge.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Charge.Count(), 'The excess is charged');
    end;

    [Test]
    procedure ShortTripIsNotCharged()
    var
        Charge: Record "CGR Return Excess Charge";
        ReturnDesk: Codeunit "CGR Return Desk";
        ContractNo: Code[20];
    begin
        ExistsPrepare();
        ContractNo := ExistsContract('HX139-NE2');

        ReturnDesk.BookReturn(ContractNo, 1100);

        Charge.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Charge.Count(), 'Within the allowance nothing is charged');
    end;

    [Test]
    [HandlerFunctions('ExistsMessageHandler')]
    procedure OpenDamageMessageText()
    var
        Damage: Record "CGR Damage Entry";
        ReturnDesk: Codeunit "CGR Return Desk";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ExistsPrepare();
        ExistsText := '';
        Lib.CreateVehicle('HX139-NE3', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Damage.Init();
        Damage."Vehicle No." := 'HX139-NE3';
        Damage.Insert();
        Damage.Init();
        Damage."Entry No." := 0;
        Damage."Vehicle No." := 'HX139-NE3';
        Damage.Insert();
        Damage.Init();
        Damage."Entry No." := 0;
        Damage."Vehicle No." := 'HX139-NE3';
        Damage.Repaired := true;
        Damage.Insert();
        ContractNo := RentalMgt.CreateContract('HX139-NE3', 'Naive Customer', 20250407D, 20250409D);
        RentalMgt.CheckOut(ContractNo);

        ReturnDesk.BookReturn(ContractNo, 1100);

        Assert.AreEqual('Vehicle HX139-NE3 has 2 open damages. Inspect it before it is rented again.', ExistsText, 'Open damages message');
    end;

    [MessageHandler]
    procedure ExistsMessageHandler(Message: Text[1024])
    begin
        ExistsText := Message;
    end;

    local procedure ExistsPrepare()
    begin
        WorkDate(20250415D);
        Lib.SetPricing(0, 100, 0.35);
    end;

    local procedure ExistsContract(VehicleNo: Code[20]): Code[20]
    var
        Charge: Record "CGR Return Excess Charge";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'Naive Customer', 20250407D, 20250409D);
        RentalMgt.CheckOut(ContractNo);
        Charge.SetRange("Contract No.", ContractNo);
        Charge.DeleteAll();
        exit(ContractNo);
    end;
}
