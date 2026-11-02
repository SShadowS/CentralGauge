table 70341 "CGR Third-Party Share"
{
    DataClassification = CustomerContent;

    // The part of an owner statement we pay to a third party, usually the owner's financing bank.
    fields
    {
        field(1; "Statement Entry No."; Integer) { TableRelation = "CGR Owner Statement Line"; }
        field(2; "Line No."; Integer) { }
        field(3; "Payee Code"; Code[20]) { }
        field(4; "Due Date"; Date) { }
        field(5; Amount; Decimal) { }
        field(6; Open; Boolean) { }
        field(7; "On Hold"; Boolean) { }
    }

    keys
    {
        key(PK; "Statement Entry No.", "Line No.") { Clustered = true; }
    }
}
