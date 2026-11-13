table 70386 "CGR Lease Exposure Line"
{
    Caption = 'Lease Exposure Line';
    DataClassification = CustomerContent;
    TableType = Temporary;

    fields
    {
        field(1; "Line No."; Integer) { }
        field(2; "Company Name"; Text[30]) { }
        field(3; "Open Leases"; Integer) { }
        field(4; "Open Balance"; Decimal) { }
    }

    keys
    {
        key(PK; "Line No.") { Clustered = true; }
    }
}
