codeunit 88015 "HX137 Contract No. Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        RefusedTxt: Label 'HX137 partner refused the contract.', Locked = true;
        BookingFailedTxt: Label 'HX137 booking failed after the contract was created.', Locked = true;

    [Test]
    procedure TwelveContractsNumberedInOrder()
    var
        Numbers: List of [Code[20]];
        i: Integer;
    begin
        InitHX137(8801500);

        for i := 1 to 12 do
            Numbers.Add(NewContractHX137());

        Assert.AreEqual('RC8801501', Numbers.Get(1), 'The first number follows "Last Contract No."');
        Assert.AreEqual('RC8801510', Numbers.Get(10), 'The tenth number is the last of the first block');
        Assert.AreEqual('RC8801511', Numbers.Get(11), 'The eleventh number is the first of the next block');
        Assert.AreEqual('RC8801512', Numbers.Get(12), 'The twelfth number follows the eleventh');
        Assert.AreEqual(12, CountInRangeHX137(8801500), 'Twelve contracts with twelve distinct numbers');
    end;

    [Test]
    procedure SetupCounterAdvancesPerBlock()
    var
        i: Integer;
    begin
        InitHX137(8801600);

        NewContractHX137();
        Assert.AreEqual(8801610, CounterHX137(), '"Last Contract No." holds the last number of the reserved block after the first contract');
        for i := 2 to 10 do
            NewContractHX137();
        Assert.AreEqual(8801610, CounterHX137(), 'The setup row is not advanced again within the block of 10');
        NewContractHX137();
        Assert.AreEqual(8801620, CounterHX137(), 'The eleventh contract reserves the next block of 10');
    end;

    [Test]
    procedure CopyAndCreateShareThePool()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        LastNo: Code[20];
        i: Integer;
    begin
        InitHX137(8801700);

        for i := 1 to 8 do
            LastNo := NewContractHX137();
        Assert.AreEqual('RC8801709', RentalMgt.CopyContract(LastNo, 20260120D, 20260122D), 'CopyContract takes the next number of the pool');
        Assert.AreEqual('RC8801710', NewContractHX137(), 'CreateContract continues after the copy');
        Assert.AreEqual('RC8801711', RentalMgt.CopyContract(LastNo, 20260120D, 20260122D), 'A copy across the block boundary takes the next block''s first number');
        Assert.AreEqual('RC8801712', NewContractHX137(), 'CreateContract continues after the second copy');
        Assert.AreEqual(12, CountInRangeHX137(8801700), 'Twelve contracts with twelve distinct numbers');
    end;

    [Test]
    procedure RefusedContractNumberNotReused()
    var
        Refuser: Codeunit "HX137 Contract Refuser";
        ContractNo: Code[20];
    begin
        InitHX137(8801800);

        BindSubscription(Refuser);
        asserterror NewContractHX137();
        Assert.ExpectedError(RefusedTxt);
        UnbindSubscription(Refuser);
        ContractNo := NewContractHX137();

        AssertReservedHX137(ContractNo, 8801800, 'after a contract a partner refused');
    end;

    [Test]
    procedure RefusalThenNextSessionNoDuplicate()
    var
        Pool: Codeunit "CGR Contract No. Pool";
        Refuser: Codeunit "HX137 Contract Refuser";
        FirstNo: Code[20];
        SecondNo: Code[20];
        ThirdNo: Code[20];
    begin
        InitHX137(8801900);

        BindSubscription(Refuser);
        asserterror NewContractHX137();
        Assert.ExpectedError(RefusedTxt);
        UnbindSubscription(Refuser);
        FirstNo := NewContractHX137();
        Pool.Reset();
        SecondNo := NewContractHX137();
        ThirdNo := NewContractHX137();

        Assert.AreNotEqual(FirstNo, SecondNo, 'The next session does not reuse the first session''s number');
        Assert.AreNotEqual(FirstNo, ThirdNo, 'The next session does not reuse the first session''s number');
        Assert.AreNotEqual(SecondNo, ThirdNo, 'Two contracts of one session get different numbers');
        Assert.AreEqual(3, CountInRangeHX137(8801900), 'Three contracts with three distinct numbers');
    end;

    [Test]
    procedure FailedBookingKeepsNothing()
    var
        Runner: Codeunit "HX137 Booking Runner";
        Contract: Record "CGR Rental Contract";
        Ok: Boolean;
    begin
        InitHX137(8802000);
        Runner.SetHX137Marker('HX137-MARK6');
        Commit();

        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'The booking fails after the contract was created');
        Assert.AreEqual(BookingFailedTxt, GetLastErrorText(), 'The booking fails with its own error');
        Assert.IsFalse(Contract.Get('HX137-MARK6'), 'A failed booking is rolled back: the booking''s own write is not kept');
        Assert.AreEqual(0, CountInRangeHX137(8802000), 'A failed booking is rolled back: its contract is not kept');
        Assert.AreEqual(8802000, CounterHX137(), 'A failed booking is rolled back: the setup row is unchanged');
    end;

    [Test]
    procedure FailedBookingNumberNotReused()
    var
        Runner: Codeunit "HX137 Booking Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        InitHX137(8802100);
        Runner.SetHX137Marker('HX137-MARK7');
        Commit();

        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'The booking fails after the contract was created');
        ContractNo := NewContractHX137();

        AssertReservedHX137(ContractNo, 8802100, 'after a failed booking');
    end;

    [Test]
    procedure RefusedCopyNumberNotReused()
    var
        Source: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Refuser: Codeunit "HX137 Contract Refuser";
        ContractNo: Code[20];
    begin
        InitHX137(8802200);
        Source.Init();
        Source."No." := 'HX137-SRC8';
        Source."Vehicle No." := 'HX137-V8';
        Source."Customer Name" := 'HX137 Source';
        Source.Insert();
        Commit();

        BindSubscription(Refuser);
        asserterror RentalMgt.CopyContract('HX137-SRC8', 20260120D, 20260122D);
        Assert.ExpectedError(RefusedTxt);
        UnbindSubscription(Refuser);
        ContractNo := RentalMgt.CopyContract('HX137-SRC8', 20260120D, 20260122D);

        AssertReservedHX137(ContractNo, 8802200, 'after a copy a partner refused');
    end;

    local procedure InitHX137(Seed: Integer)
    var
        Setup: Record "CGR Setup";
        Contract: Record "CGR Rental Contract";
        Pool: Codeunit "CGR Contract No. Pool";
    begin
        WorkDate(20260105D);
        Pool.Reset();
        Contract.SetRange("No.", NoHX137(Seed), NoHX137(Seed + 99));
        Contract.DeleteAll();
        Contract.Reset();
        Contract.SetFilter("No.", 'HX137-*');
        Contract.DeleteAll();
        Setup.GetOrCreate();
        Setup."Last Contract No." := Seed;
        Setup.Modify();
        Commit();
    end;

    local procedure NewContractHX137(): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        exit(RentalMgt.CreateContract('HX137-V1', 'HX137 Customer', 20260110D, 20260112D));
    end;

    local procedure AssertReservedHX137(ContractNo: Code[20]; Seed: Integer; Context: Text)
    var
        Contract: Record "CGR Rental Contract";
        No: Integer;
    begin
        Assert.IsTrue(Contract.Get(ContractNo), 'The contract created ' + Context + ' exists');
        Assert.IsTrue(Evaluate(No, CopyStr(ContractNo, 3)), 'The contract number has the format RC<number>: ' + ContractNo);
        Assert.IsTrue(No > Seed, 'The number created ' + Context + ' follows "Last Contract No." before it: ' + ContractNo);
        Assert.IsTrue(No <= CounterHX137(),
            StrSubstNo('The number created %1 lies in a block the setup row holds: %2, "Last Contract No." %3', Context, ContractNo, CounterHX137()));
    end;

    local procedure CounterHX137(): Integer
    var
        Setup: Record "CGR Setup";
    begin
        Setup.Get();
        exit(Setup."Last Contract No.");
    end;

    local procedure CountInRangeHX137(Seed: Integer): Integer
    var
        Contract: Record "CGR Rental Contract";
    begin
        Contract.SetRange("No.", NoHX137(Seed), NoHX137(Seed + 99));
        exit(Contract.Count());
    end;

    local procedure NoHX137(No: Integer): Code[20]
    begin
        exit(CopyStr('RC' + Format(No, 0, 9), 1, 20));
    end;
}
