table 70003 "CGR Setup"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Primary Key"; Code[10]) { }
        field(2; "Last Contract No."; Integer) { }
        field(3; "Last Lease No."; Integer) { }
        field(4; "Suspend Rentals"; Boolean) { }
        field(5; "Weekend Surcharge %"; Decimal) { }
        field(6; "Km Allowance per Day"; Integer) { }
        field(7; "Excess Km Rate"; Decimal) { }
        field(8; "Amount Rounding Precision"; Decimal) { DecimalPlaces = 0 : 5; }
        field(9; "Default Branch Code"; Code[10]) { }
        field(10; "Outbox Max Attempts"; Integer) { }
    }

    keys
    {
        key(PK; "Primary Key") { Clustered = true; }
    }

    trigger OnInsert()
    var
        SessionContext: Codeunit "CGR Session Context";
    begin
        SessionContext.RefreshSetup();
    end;

    trigger OnModify()
    var
        SessionContext: Codeunit "CGR Session Context";
    begin
        SessionContext.RefreshSetup();
    end;

    trigger OnDelete()
    var
        SessionContext: Codeunit "CGR Session Context";
    begin
        SessionContext.RefreshSetup();
    end;

    procedure GetOrCreate()
    begin
        if not Get() then begin
            Init();
            Insert();
        end;
    end;

    procedure NextContractNo(): Code[20]
    begin
        GetOrCreate();
        "Last Contract No." += 1;
        Modify();
        exit(CopyStr('RC' + Format("Last Contract No.", 0, 9), 1, 20));
    end;

    procedure NextLeaseNo(): Code[20]
    begin
        GetOrCreate();
        "Last Lease No." += 1;
        Modify();
        exit(CopyStr('LC' + Format("Last Lease No.", 0, 9), 1, 20));
    end;
}
