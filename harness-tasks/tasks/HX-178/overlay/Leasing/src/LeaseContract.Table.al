table 70300 "CGR Lease Contract"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; "Vehicle No."; Code[20]) { }
        field(3; "Customer Name"; Text[100]) { }
        field(4; "Start Date"; Date) { }
        field(5; Months; Integer) { }
        field(6; "Base Rate"; Decimal) { }
        field(7; "Dimension Set ID"; Integer) { Editable = false; }
        field(8; "Job No."; Code[20]) { TableRelation = Job; }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
