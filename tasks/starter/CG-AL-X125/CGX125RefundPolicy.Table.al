table 70850 "CG X125 Refund Policy"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Primary Key"; Code[10]) { DataClassification = CustomerContent; }
        field(2; "Approval Threshold"; Integer) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Primary Key") { Clustered = true; }
    }
}
