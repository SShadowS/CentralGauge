query 70596 "CGR Vehicle Damage Roster"
{
    QueryType = Normal;

    elements
    {
        dataitem(Vehicle; "CGR Vehicle")
        {
            column(VehicleNo; "No.") { }
            dataitem(Damage; "CGR Damage Entry")
            {
                DataItemLink = "Vehicle No." = Vehicle."No.";
                column(DamagesReported) { Method = Count; }
                filter(ReportedOnFilter; "Reported On") { }
            }
        }
    }
}
