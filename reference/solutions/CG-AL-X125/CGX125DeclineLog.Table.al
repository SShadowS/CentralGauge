table 70853 "CG X125 Decline Log"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { DataClassification = CustomerContent; }
        field(2; "Customer No."; Code[20]) { DataClassification = CustomerContent; }
        field(3; Amount; Integer) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
