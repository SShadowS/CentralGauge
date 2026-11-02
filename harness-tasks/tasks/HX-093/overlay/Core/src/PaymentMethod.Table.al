table 70019 "CGR Payment Method"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; Code; Code[10]) { }
        field(2; Description; Text[50]) { }
        field(3; "Balancing Account No."; Code[20]) { }
        field(4; "Posts to Customer Account"; Boolean) { }
    }

    keys
    {
        key(PK; Code) { Clustered = true; }
    }
}
