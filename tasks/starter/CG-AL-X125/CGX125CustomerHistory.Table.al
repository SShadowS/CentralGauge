table 70852 "CG X125 Customer History"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Customer No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Declined Count"; Integer) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Customer No.") { Clustered = true; }
    }
}
