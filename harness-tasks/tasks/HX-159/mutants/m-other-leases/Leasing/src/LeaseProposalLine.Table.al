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
        Contract.SetRange("Customer Name", Contract."Customer Name");
        Contract.SetFilter("Proposed Through", '>=%1', "Due Date");
        Contract.ModifyAll("Proposed Through", CalcDate('<-1D>', "Due Date"));
    end;
}
