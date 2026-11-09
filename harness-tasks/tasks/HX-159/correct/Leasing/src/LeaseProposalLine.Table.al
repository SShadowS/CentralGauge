table 70381 "CGR Lease Proposal Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Contract No."; Code[20]) { }
        field(2; "Schedule Line No."; Integer) { }
        field(3; "Due Date"; Date) { }
        field(4; Amount; Decimal) { }
    }

    keys
    {
        key(PK; "Contract No.", "Schedule Line No.") { Clustered = true; }
    }

    trigger OnDelete()
    var
        Contract: Record "CGR Lease Contract";
    begin
        Contract.Get("Contract No.");
        if Contract."Proposed Through" >= "Due Date" then begin
            Contract."Proposed Through" := CalcDate('<-1D>', "Due Date");
            Contract.Modify();
        end;
    end;
}
