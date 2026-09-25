table 70003 "CGR Setup"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Primary Key"; Code[10]) { }
        field(2; "Last Contract No."; Integer) { }
        field(3; "Last Lease No."; Integer) { }
        field(4; "Suspend Rentals"; Boolean) { }
    }

    keys
    {
        key(PK; "Primary Key") { Clustered = true; }
    }

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
